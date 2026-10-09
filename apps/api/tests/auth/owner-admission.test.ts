import { mkdtemp, writeFile, chmod, unlink, symlink, link, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createFileOwnerAdmission, createMiniAppOnboarding } from "../../src/auth/index.js";
import { ownerAdmissionPolicy } from "../../src/auth/application/owner-admission.js";
import { sessionService } from "../../src/auth/application/sessions.js";
import { botOnboardingService } from "../../src/auth/application/bot-onboarding.js";
import { fixture, initData, commandId } from "./session-fixtures.js";
import { onboardingFixture } from "./onboarding-fixtures.js";
import { botFixture, botContext, update, acknowledge } from "./bot-onboarding-fixtures.js";

it("checks signature before registration and rechecks durable completion for cached credentials", async () => {
  const f = fixture();
  let completed = true;
  const users = {
    findActiveByTelegramId: vi.fn(async () => ({
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      registrationCompleted: completed,
    })),
    findActiveById: vi.fn(async () => ({
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      registrationCompleted: completed,
    })),
  };
  const service = sessionService({ ...f.deps, users });
  expect(await service.issue(initData().replace("Synthetic", "Forged"), commandId)).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
  expect(users.findActiveByTelegramId).not.toHaveBeenCalled();
  const issued = await service.issue(initData(), commandId);
  if (!issued.ok) throw new Error("Expected synthetic session");
  completed = false;
  expect(await service.authenticate(issued.accessToken.reveal())).toMatchObject({
    error: { code: "REGISTRATION_REQUIRED" },
  });
  expect(await service.issue(initData(), commandId)).toMatchObject({
    error: { code: "REGISTRATION_REQUIRED" },
  });
  expect(f.rows.size).toBe(1);
});

it("denies non-owner signed issuance before durable session effects and rechecks old sessions", async () => {
  const f = fixture();
  let owner: string | undefined = "42";
  const ownerAdmission = ownerAdmissionPolicy({ readOwner: async () => owner, users: f.users });
  const sessions = sessionService({ ...f.deps, ownerAdmission });
  expect((await sessions.issue(initData(43), commandId)).ok).toBe(false);
  expect(f.rows.size).toBe(0);
  const issued = await sessions.issue(initData(), commandId);
  expect(issued.ok).toBe(true);
  if (!issued.ok) throw new Error("Synthetic issuance failed");
  expect((await sessions.authenticate(issued.accessToken.reveal())).ok).toBe(true);
  owner = "43";
  expect((await sessions.authenticate(issued.accessToken.reveal())).ok).toBe(false);
  expect((await sessions.revoke(issued.accessToken.reveal())).ok).toBe(false);
  expect([...f.rows.values()][0]?.revokedAt).toBeNull();
  owner = undefined;
  expect((await sessions.issue(initData(), commandId)).ok).toBe(false);
});
it("denies non-owner Mini App onboarding before the Users port, including retries", async () => {
  const f = onboardingFixture();
  const ownerAdmission = ownerAdmissionPolicy({ readOwner: async () => "42", users: f.users });
  const onboarding = createMiniAppOnboarding({ ...f, ownerAdmission });
  for (let i = 0; i < 2; i++)
    expect((await onboarding.create(initData(99), commandId, "Synthetic")).ok).toBe(false);
  expect(f.create).not.toHaveBeenCalled();
  expect(f.accountsByTelegram.size).toBe(2);
  expect((await onboarding.create(initData(), commandId, "Synthetic")).ok).toBe(true);
});
it("denies an otherwise valid old non-owner session", async () => {
  const f = fixture();
  const old = await f.service.issue(initData(43), commandId);
  if (!old.ok) throw new Error("Synthetic issuance failed");
  const sessions = sessionService({
    ...f.deps,
    ownerAdmission: ownerAdmissionPolicy({ readOwner: async () => "42", users: f.users }),
  });
  expect((await sessions.authenticate(old.accessToken.reveal())).ok).toBe(false);
});
it("Bot admission denies before receipt/flow/account writes and rechecks acknowledgement", async () => {
  const f = botFixture();
  let owner: string | undefined = "100";
  const service = botOnboardingService({
    ...f.deps,
    ownerAdmission: ownerAdmissionPolicy({ readOwner: async () => owner }),
  });
  expect((await service.process(botContext, update("CREATE", 1, "101"))).ok).toBe(false);
  expect(f.receipts.size).toBe(0);
  expect(f.flows.size).toBe(0);
  expect(f.create).not.toHaveBeenCalled();
  const accepted = await service.process(botContext, update("CREATE"));
  expect(accepted.ok).toBe(true);
  owner = "101";
  expect((await acknowledge(service, accepted)).ok).toBe(false);
  expect([...f.receipts.values()][0]?.phase).toBe("REPLY");
  owner = undefined;
  expect((await acknowledge(service, accepted)).ok).toBe(false);
});
it("missing/malformed/read-failing policy always denies without exposing errors", async () => {
  const admission = ownerAdmissionPolicy({
    readOwner: async () => {
      throw new Error("private-canary");
    },
  });
  expect(await admission.telegramId()).toBeUndefined();
  expect(await admission.allowsTelegramId("42")).toBe(false);
  expect(await admission.allowsUserId("42")).toBe(false);
});
it("keeps the owner identity separate, enforces registration and revokes tester sessions immediately", async () => {
  const f = fixture();
  let test: string | undefined = "43",
    completed = false;
  const users = {
    ...f.users,
    async findActiveByTelegramId(id: string) {
      const user = await f.users.findActiveByTelegramId(id);
      return user ? { ...user, registrationCompleted: id === "43" ? completed : true } : undefined;
    },
    async findActiveById(id: string) {
      const user = await f.users.findActiveById(id);
      return user
        ? {
            ...user,
            registrationCompleted: id === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" ? completed : true,
          }
        : undefined;
    },
  };
  const policy = ownerAdmissionPolicy({
    readOwner: async () => "42",
    readTestUser: async () => test,
    users,
  });
  const sessions = sessionService({ ...f.deps, users, ownerAdmission: policy });
  expect(await policy.telegramId()).toBe("42");
  expect(await sessions.issue(initData(43), commandId)).toMatchObject({
    error: { code: "REGISTRATION_REQUIRED" },
  });
  expect(f.rows.size).toBe(0);
  completed = true;
  const issued = await sessions.issue(initData(43), commandId);
  if (!issued.ok) throw Error("Expected synthetic test session");
  expect((await sessions.authenticate(issued.accessToken.reveal())).ok).toBe(true);
  expect((await sessions.issue(initData(44), commandId)).ok).toBe(false);
  test = undefined;
  expect((await sessions.authenticate(issued.accessToken.reveal())).ok).toBe(false);
  expect(await policy.allowsTelegramId("42")).toBe(true);
  expect(await policy.telegramId()).toBe("42");
});
it("separate private test file is numeric-only, reloads revocation and never replaces the owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hambazi-tester-test-"));
  const owner = join(dir, "owner.json"),
    tester = join(dir, "tester.json");
  try {
    await writeFile(
      owner,
      JSON.stringify({
        schemaVersion: 1,
        purpose: "temporary-owner-only",
        telegramUserIds: ["42"],
      }),
      { mode: 0o600 },
    );
    const raw = JSON.stringify({
      schemaVersion: 1,
      purpose: "temporary-staging-regular-test-user",
      telegramUserIds: ["43"],
    });
    await writeFile(tester, raw, { mode: 0o600 });
    const policy = createFileOwnerAdmission(owner, undefined, tester);
    expect(await policy.allowsTelegramId("43")).toBe(true);
    expect(await policy.telegramId()).toBe("42");
    await chmod(tester, 0o644);
    expect(await policy.allowsTelegramId("43")).toBe(false);
    expect(await policy.allowsTelegramId("42")).toBe(true);
    await chmod(tester, 0o600);
    await writeFile(tester, raw);
    await link(tester, join(dir, "linked"));
    expect(await policy.allowsTelegramId("43")).toBe(false);
    await unlink(join(dir, "linked"));
    await writeFile(
      tester,
      JSON.stringify({
        schemaVersion: 1,
        purpose: "temporary-staging-regular-test-user",
        telegramUserIds: [],
      }),
    );
    expect(await policy.allowsTelegramId("43")).toBe(false);
    expect(await policy.allowsTelegramId("42")).toBe(true);
    await unlink(tester);
    await writeFile(join(dir, "target"), raw, { mode: 0o600 });
    await symlink(join(dir, "target"), tester);
    expect(await policy.allowsTelegramId("43")).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("actual file admission rejects permission changes, links, malformed content and deletion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hambazi-owner-test-"));
  const path = join(dir, "owner.json");
  const raw = JSON.stringify({
    schemaVersion: 1,
    purpose: "temporary-owner-only",
    telegramUserIds: ["42"],
  });
  try {
    await writeFile(path, raw, { mode: 0o600 });
    const admission = createFileOwnerAdmission(path);
    expect(await admission.allowsTelegramId("42")).toBe(true);
    expect(await admission.allowsTelegramId("43")).toBe(false);
    await chmod(path, 0o644);
    expect(await admission.telegramId()).toBeUndefined();
    await chmod(path, 0o600);
    await writeFile(path, "private-canary");
    expect(await admission.telegramId()).toBeUndefined();
    await writeFile(path, raw);
    await link(path, join(dir, "linked"));
    expect(await admission.telegramId()).toBeUndefined();
    await unlink(join(dir, "linked"));
    await unlink(path);
    expect(await admission.telegramId()).toBeUndefined();
    await writeFile(join(dir, "real"), raw, { mode: 0o600 });
    await symlink(join(dir, "real"), path);
    expect(await admission.telegramId()).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

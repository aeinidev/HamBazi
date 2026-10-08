import { mkdtemp, writeFile, chmod, unlink, symlink, link, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createFileOwnerAdmission, createMiniAppOnboarding } from "../../src/auth/index.js";
import { ownerAdmissionPolicy } from "../../src/auth/application/owner-admission.js";
import { sessionService } from "../../src/auth/application/sessions.js";
import { botOnboardingService } from "../../src/auth/application/bot-onboarding.js";
import { fixture, initData, commandId } from "./session-fixtures.js";
import { onboardingFixture } from "./onboarding-fixtures.js";
import { botFixture, botContext, update, acknowledge } from "./bot-onboarding-fixtures.js";

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

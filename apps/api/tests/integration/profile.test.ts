import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@hambazi/database";
import { createProfileRepository } from "../../src/users/infrastructure/repositories/profile.js";
import { profileService } from "../../src/users/application/profile.js";
import {
  createAccountCreationPort,
  createProfilePort,
  createProfileCleanup,
  createProfileRate,
} from "../../src/users/index.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
  !process.env.TEST_DATABASE_URL ||
  !process.env.API_DATABASE_URL ||
  !process.env.WORKER_DATABASE_URL
)
  throw new Error("Use isolated test:auth-http:local harness");
const config = {
  poolMax: 8,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
};
const admin = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
});
const a = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const b = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const worker = createDatabase({
  ...config,
  databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
});
beforeAll(async () => {
  await Promise.all([admin.connect(), a.connect(), b.connect(), worker.connect()]);
});
afterAll(async () => {
  await Promise.all([admin.disconnect(), a.disconnect(), b.disconnect(), worker.disconnect()]);
});
let seq = 950000;
async function fixture() {
  const created = await createAccountCreationPort(a).createForVerifiedTelegramIdentity(
    String(++seq),
    "Original",
  );
  if (!created.ok) throw new Error("Account fixture failed");
  const clock = {
    value: Date.parse("2030-01-01T00:00:00Z"),
    nowMs() {
      return this.value;
    },
  };
  const first = createProfilePort(a, clock);
  const second = createProfilePort(b, clock);
  const userId = created.account.userId;
  const input = (version = 0, name = "  Mehdi  ") => ({
    schemaVersion: 1,
    commandId: randomUUID(),
    expectedVersion: version,
    patch: { displayName: name, settings: { theme: "dark" } },
  });
  return { first, second, userId, clock, input, handle: created.account.publicHandle };
}
describe("durable profile", () => {
  it("rolls back name, settings and revision when receipt insertion fails", async () => {
    const f = await fixture();
    const failing = profileService(createProfileRepository(a, f.clock, () => "invalid-uuid"));
    expect(await failing.patch(f.userId, f.input())).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
    expect(await f.first.read(f.userId)).toMatchObject({
      profile: { displayName: "Original", version: 0, settings: { theme: "system" } },
    });
    expect(
      await admin
        .forModule("users")
        .execute((db) => db.profileMutationReceipt.count({ where: { userId: f.userId } })),
    ).toBe(0);
    expect(
      await admin
        .forModule("users")
        .execute((db) => db.userSettings.count({ where: { userId: f.userId } })),
    ).toBe(0);
  });
  it("reads default settings without writes; atomically edits and preserves handle", async () => {
    const f = await fixture();
    expect(await f.first.read(f.userId)).toMatchObject({
      ok: true,
      profile: { version: 0, settings: { locale: "auto", theme: "system" } },
    });
    expect(
      await admin
        .forModule("users")
        .execute((db) => db.userSettings.count({ where: { userId: f.userId } })),
    ).toBe(0);
    expect(await f.first.patch(f.userId, f.input())).toMatchObject({ ok: true, appliedVersion: 1 });
    expect(await f.second.read(f.userId)).toMatchObject({
      profile: {
        displayName: "Mehdi",
        publicHandle: f.handle,
        version: 1,
        settings: { locale: "auto", theme: "dark" },
      },
    });
  });
  it("eight retries across two clients apply once, including recovery after losing acknowledgement", async () => {
    const f = await fixture();
    const input = f.input();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => (i % 2 ? f.first : f.second).patch(f.userId, input)),
    );
    for (const result of results)
      expect(result).toEqual({ ok: true, commandId: input.commandId, appliedVersion: 1 });
    const newer = f.input(1, "Newer");
    expect(await f.second.patch(f.userId, newer)).toMatchObject({ ok: true, appliedVersion: 2 });
    expect(await createProfilePort(b, f.clock).patch(f.userId, input)).toEqual(results[0]);
    expect(await f.first.read(f.userId)).toMatchObject({
      profile: { displayName: "Newer", version: 2 },
    });
  });
  it("one of two distinct concurrent edits wins; stale writes never overwrite", async () => {
    const f = await fixture();
    const results = await Promise.all([
      f.first.patch(f.userId, f.input(0, "A")),
      f.second.patch(f.userId, f.input(0, "B")),
    ]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.filter((x) => !x.ok)).toEqual([
      expect.objectContaining({ error: expect.objectContaining({ code: "PROFILE_CONFLICT" }) }),
    ]);
    expect(await f.first.read(f.userId)).toMatchObject({ profile: { version: 1 } });
  });
  it("normalizes retries, rejects command reuse and increments same-value edits", async () => {
    const f = await fixture();
    const input = f.input();
    const result = await f.first.patch(f.userId, input);
    expect(
      await f.first.patch(f.userId, {
        ...input,
        patch: { settings: { theme: "dark" }, displayName: "Mehdi" },
      }),
    ).toEqual(result);
    expect(await f.first.patch(f.userId, { ...input, expectedVersion: 1 })).toMatchObject({
      error: { code: "PROFILE_CONFLICT" },
    });
    expect(await f.first.patch(f.userId, f.input(1, "Mehdi"))).toMatchObject({ appliedVersion: 2 });
  });
  it("expires receipts exactly after 168 hours; worker cleanup is bounded and idempotent", async () => {
    const f = await fixture();
    const input = f.input();
    await f.first.patch(f.userId, input);
    f.clock.value += 168 * 3600000 - 1;
    expect(await f.first.patch(f.userId, input)).toMatchObject({ ok: true });
    f.clock.value++;
    expect(await f.first.patch(f.userId, input)).toMatchObject({
      error: { code: "PROFILE_CONFLICT" },
    });
    const cleanup = createProfileCleanup(worker, f.clock);
    const result = await cleanup({ schemaVersion: 1, limit: 1 });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.receipts).toBeLessThanOrEqual(1);
    for (let i = 0; i < 20; i++) await cleanup({ schemaVersion: 1, limit: 500 });
    expect(await cleanup({ schemaVersion: 1, limit: 500 })).toEqual({
      ok: true,
      receipts: 0,
      flows: 0,
    });
    expect(await f.first.patch(f.userId, input)).toMatchObject({
      error: { code: "PROFILE_CONFLICT" },
    });
    await expect(
      worker
        .forModule("users")
        .execute((db) => db.profileMutationReceipt.findMany({ select: { requestDigest: true } })),
    ).rejects.toThrow();
    await expect(worker.forModule("users").execute((db) => db.user.findMany())).rejects.toThrow();
  });
  it("current eligibility denies reads and even committed retries", async () => {
    const f = await fixture();
    const input = f.input();
    await f.first.patch(f.userId, input);
    await admin
      .forModule("users")
      .execute((db) => db.user.update({ where: { id: f.userId }, data: { status: "BANNED" } }));
    expect(await f.first.read(f.userId)).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(await f.first.patch(f.userId, input)).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });
  it("rejects unsupported persisted settings without partial mutation", async () => {
    const f = await fixture();
    await admin
      .forModule("users")
      .execute((db) =>
        db.userSettings.create({ data: { userId: f.userId, schemaVersion: 2, settingsJsonb: {} } }),
      );
    expect(await f.first.patch(f.userId, f.input())).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
    expect(
      await admin.forModule("users").execute((db) =>
        db.user.findUnique({
          where: { id: f.userId },
          select: { profileVersion: true, displayName: true },
        }),
      ),
    ).toEqual({ profileVersion: 0, displayName: "Original" });
  });
  it("scopes command IDs to the user and stores no historical names/settings", async () => {
    const f = await fixture();
    const g = await fixture();
    const input = f.input();
    expect(await f.first.patch(f.userId, input)).toMatchObject({ ok: true });
    expect(await g.first.patch(g.userId, input)).toMatchObject({ ok: true });
    const rows = await admin
      .forModule("users")
      .execute((db) => db.profileMutationReceipt.findMany({ where: { userId: f.userId } }));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("Mehdi");
    expect(JSON.stringify(rows)).not.toContain("dark");
    expect(rows[0]!.requestDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});
it.skipIf(!process.env.TEST_AUTH_REDIS_URL)(
  "shares Redis read/write quotas across clients and distinguishes outage",
  async () => {
    const options = {
      url: { reveal: () => process.env.TEST_AUTH_REDIS_URL! },
      namespace: randomUUID(),
      readLimit: 2,
      writeLimit: 1,
    };
    const one = createProfileRate(options);
    const two = createProfileRate(options);
    const id = randomUUID();
    try {
      await Promise.all([one.connect(), two.connect()]);
      expect(await one.consume("read", id)).toEqual({ allowed: true });
      expect(await two.consume("read", id)).toEqual({ allowed: true });
      expect(await one.consume("read", id)).toMatchObject({ reason: "limited" });
      expect(await two.consume("write", id)).toEqual({ allowed: true });
      expect(await one.consume("write", id)).toMatchObject({ reason: "limited" });
      one.close();
      expect(await one.consume("read", id)).toEqual({ allowed: false, reason: "unavailable" });
    } finally {
      one.close();
      two.close();
    }
  },
);

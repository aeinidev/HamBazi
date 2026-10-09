import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "@hambazi/database";
import { createBotOnboarding, createAuthSessions } from "../../src/auth/index.js";
import { ownerAdmissionPolicy } from "../../src/auth/application/owner-admission.js";
import { createSupportRepository } from "../../src/auth/infrastructure/repositories/bot-support.js";
import {
  createAccountCreationPort,
  createRegistrationPort,
  createUserIdentityPort,
} from "../../src/users/index.js";
import { botContext, acknowledge } from "../auth/bot-onboarding-fixtures.js";
import { initData, telegram, signing, now } from "../auth/session-fixtures.js";
import { createPersonalMatchPort } from "../../src/matches/index.js";
import { createPersonalCoupGame } from "../../src/composition/personal-coup.js";
export function botExperienceIntegrationCases(admin: ReturnType<typeof createDatabase>) {
  describe("registration and support durability with least-privilege PostgreSQL", () => {
    const settings = {
      poolMax: 8,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      transactionMaxWaitMs: 5000,
      transactionTimeoutMs: 5000,
    };
    const a = createDatabase({
      ...settings,
      databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
    });
    const b = createDatabase({
      ...settings,
      databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
    });
    beforeAll(async () => {
      await Promise.all([a.connect(), b.connect()]);
    });
    afterAll(async () => {
      await Promise.all([a.disconnect(), b.disconnect()]);
    });
    let seq = 150000;
    function setup(regularTester = false) {
      const id = String(++seq);
      const ownerId = regularTester ? String(++seq) : id;
      let testUser = regularTester ? id : undefined;
      const clock = {
        value: now * 1000,
        nowMs() {
          return this.value;
        },
      };
      const ownerAdmission = ownerAdmissionPolicy({
        readOwner: async () => ownerId,
        readTestUser: async () => testUser,
        users: createUserIdentityPort(a),
      });
      const registration = createRegistrationPort(a, clock);
      const make = (database = a) =>
        createBotOnboarding({
          database,
          accounts: createAccountCreationPort(database),
          users: createUserIdentityPort(database),
          registration: createRegistrationPort(database, clock),
          clock,
          ownerAdmission,
          leaseMs: 5000,
          supportTimeoutMs: 60000,
        });
      const service = make();
      const command = (action: string, extra = {}) => ({
        schemaVersion: 1,
        updateId: ++seq,
        messageId: seq + 1,
        senderId: id,
        chatId: id,
        chatType: "private",
        action,
        ...extra,
      });
      const process = (action: string, extra = {}) =>
        service.process(botContext, command(action, extra));
      return {
        id,
        ownerId,
        clock,
        registration,
        service,
        make,
        command,
        process,
        ownerAdmission,
        revokeTestAdmission() {
          testUser = undefined;
        },
      };
    }
    it("keeps a regular tester unregistered until explicit intent, isolates personal games and support, and revokes ordinary credentials", async () => {
      const f = setup(true);
      const sessions = createAuthSessions({
        database: a,
        users: createUserIdentityPort(a),
        telegram,
        clock: f.clock,
        signing,
        lifetimeSeconds: 120,
        ownerAdmission: f.ownerAdmission,
      });
      await acknowledge(f.service, await f.process("START"));
      expect(await f.registration.read(f.id)).toBeUndefined();
      expect(await sessions.issue(initData(Number(f.id)), randomUUID())).toMatchObject({
        error: { code: "REGISTRATION_REQUIRED" },
      });
      await acknowledge(f.service, await f.process("REGISTER", { displayName: "Regular tester" }));
      const profile = await f.registration.read(f.id);
      expect(profile?.completed).toBe(true);
      if (!profile) throw Error("Expected isolated profile");
      const issued = await sessions.issue(initData(Number(f.id)), randomUUID());
      if (!issued.ok) throw Error("Expected isolated registered session");
      expect((await sessions.authenticate(issued.accessToken.reveal())).ok).toBe(true);
      expect(await f.ownerAdmission.telegramId()).toBe(f.ownerId);
      const ownerProfile = await f.registration.complete(f.ownerId, "Fixture owner");
      if (!ownerProfile.ok) throw Error("Expected isolated owner profile");
      const personal = createPersonalMatchPort(a, {
        game: createPersonalCoupGame(),
        clock: f.clock,
        owner: f.ownerAdmission,
      });
      const started = await personal.start(profile.userId, {
        schemaVersion: 1,
        commandId: randomUUID(),
      });
      if (!started.ok) throw Error("Expected isolated personal match");
      const snapshot = started.value as { matchId: string; stateVersion: number };
      expect(
        (await personal.read(profile.userId, { schemaVersion: 1, matchId: snapshot.matchId })).ok,
      ).toBe(true);
      expect(
        (
          await personal.read(ownerProfile.profile.userId, {
            schemaVersion: 1,
            matchId: snapshot.matchId,
          })
        ).ok,
      ).toBe(false);
      expect(
        (
          await personal.close(profile.userId, {
            schemaVersion: 1,
            actionId: randomUUID(),
            matchId: snapshot.matchId,
            expectedVersion: snapshot.stateVersion,
          })
        ).ok,
      ).toBe(true);
      await acknowledge(f.service, await f.process("SUPPORT"));
      const dispatch = await f.process("TEXT", { text: "Isolated ordinary support" });
      if (!dispatch.ok || dispatch.status !== "SUPPORT") throw Error("Expected isolated support");
      expect(dispatch.delivery.adminChatId).toBe(f.ownerId);
      expect(dispatch.delivery.chatId).toBe(f.id);
      expect(
        await f.service.acknowledge(botContext, {
          schemaVersion: 1,
          kind: "SUPPORT",
          submissionId: dispatch.delivery.submissionId,
          attemptVersion: dispatch.delivery.attemptVersion,
          outcome: "DELIVERED",
          messageId: 9301,
        }),
      ).toMatchObject({ status: "DONE" });
      const stored = await createSupportRepository(b).find(
        dispatch.delivery.submissionId,
        botContext.botId,
      );
      expect(stored).toMatchObject({
        status: "DELIVERED",
        adminChatId: f.ownerId,
        telegramUserId: f.id,
      });
      const deniedId = "990099009";
      expect(
        await f.process("REGISTER", {
          senderId: deniedId,
          chatId: deniedId,
          displayName: "Denied",
        }),
      ).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
      expect(await f.registration.read(deniedId)).toBeUndefined();
      f.revokeTestAdmission();
      expect((await sessions.authenticate(issued.accessToken.reveal())).ok).toBe(false);
      expect((await personal.current(profile.userId)).ok).toBe(false);
      expect(await f.ownerAdmission.allowsTelegramId(f.ownerId)).toBe(true);
    });
    it("does not backfill technical users; explicit repeated registration preserves their data and enables fresh auth", async () => {
      const f = setup();
      const account = await createAccountCreationPort(a).createForVerifiedTelegramIdentity(
        f.id,
        "Original",
      );
      if (!account.ok) throw new Error("Synthetic account failed");
      const sessions = createAuthSessions({
        database: a,
        users: createUserIdentityPort(a),
        telegram,
        clock: f.clock,
        signing,
        lifetimeSeconds: 120,
        ownerAdmission: f.ownerAdmission,
      });
      expect(await sessions.issue(initData(Number(f.id)), randomUUID())).toMatchObject({
        ok: false,
        error: { code: "REGISTRATION_REQUIRED" },
      });
      await acknowledge(f.service, await f.process("START"));
      expect(await f.registration.read(f.id)).toMatchObject({ completed: false });
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          createRegistrationPort(i % 2 ? a : b, f.clock).complete(f.id, "New name"),
        ),
      );
      expect(results.every((r) => r.ok)).toBe(true);
      expect(await f.registration.read(f.id)).toEqual({
        userId: account.account.userId,
        displayName: "Original",
        completed: true,
      });
      const stored = await admin
        .forModule("users")
        .execute((db) => db.user.findUniqueOrThrow({ where: { telegramUserId: BigInt(f.id) } }));
      const firstCompletedAt = stored.registrationCompletedAt;
      f.clock.value += 1000;
      await f.registration.complete(f.id, "Another");
      expect(
        (
          await admin
            .forModule("users")
            .execute((db) => db.user.findUniqueOrThrow({ where: { id: stored.id } }))
        ).registrationCompletedAt,
      ).toEqual(firstCompletedAt);
      expect(
        await sessions.issue(
          initData(Number(f.id), Math.floor(f.clock.value / 1000)),
          randomUUID(),
        ),
      ).toMatchObject({ ok: true });
      expect(await sessions.issue(initData(Number(f.id) + 1), randomUUID())).toMatchObject({
        ok: false,
        error: { code: "UNAUTHENTICATED" },
      });
    });
    it("commits one accepted support submission under simultaneous text updates and one network attempt under competing processes", async () => {
      const f = setup();
      await acknowledge(f.service, await f.process("REGISTER", { displayName: "Synthetic" }));
      await acknowledge(f.service, await f.process("SUPPORT"));
      const updates = [
        f.command("TEXT", { text: "First submitted text" }),
        f.command("TEXT", { text: "Second submitted text" }),
      ];
      const results = await Promise.all(
        updates.map((u, i) => f.make(i % 2 ? b : a).process(botContext, u)),
      );
      expect(results.filter((r) => r.ok && r.status === "SUPPORT")).toHaveLength(1);
      const rows = await admin.forModule("auth").execute((db) =>
        db.botSupportSubmission.findMany({
          where: { botId: 123n, telegramUserId: BigInt(f.id) },
        }),
      );
      expect(rows).toHaveLength(1);
      const submission = rows[0]!;
      expect(submission.status).toBe("SENDING");
      expect(submission.attemptVersion).toBe(1);
      // A simultaneous support button cannot resend the in-flight message.
      expect(await f.process("SUPPORT")).toMatchObject({ delivery: { reply: "SUPPORT_UNKNOWN" } });
      expect((await createSupportRepository(b).find(submission.id, "123"))?.attemptVersion).toBe(1);
      f.clock.value += 5001;
      const support = createSupportRepository(b);
      expect(await support.acquire(submission.id, "123", f.clock.value, 5000)).toMatchObject({
        status: "UNKNOWN",
        text: submission.text,
      });
      // Restart and replay cannot blindly resend an ambiguous attempt.
      const original = updates.find(
        (u) =>
          u.updateId === results.find((r) => r.ok && r.status === "SUPPORT")!.delivery.updateId,
      )!;
      expect(await f.make(b).process(botContext, original)).toMatchObject({
        delivery: { reply: "SUPPORT_UNKNOWN" },
      });
      expect(await support.settle(submission.id, "123", 1, "DELIVERED", 900)).toBe(true);
      expect(await support.settle(submission.id, "123", 1, "DELIVERED", 900)).toBe(true);
      expect(await support.settle(submission.id, "123", 2, "FAILED")).toBe(false);
      expect(await support.find(submission.id, "123")).toMatchObject({
        status: "DELIVERED",
        deliveryMessageId: 900,
      });
    });
    it("failure retains the original message, and an explicit retry claims it exactly once", async () => {
      const f = setup();
      await acknowledge(f.service, await f.process("REGISTER", { displayName: "Synthetic" }));
      await acknowledge(f.service, await f.process("SUPPORT"));
      const update = f.command("TEXT", { text: "Message to retry" });
      const result = await f.service.process(botContext, update);
      if (!result.ok || result.status !== "SUPPORT") throw new Error("Expected support attempt");
      await f.service.acknowledge(botContext, {
        schemaVersion: 1,
        kind: "SUPPORT",
        submissionId: result.delivery.submissionId,
        attemptVersion: 1,
        outcome: "FAILED",
      });
      f.clock.value += 5001;
      await acknowledge(f.make(b), await f.make(b).process(botContext, update));
      const retries = await Promise.all(
        [createSupportRepository(a), createSupportRepository(b)].map((repo) =>
          repo.acquire(result.delivery.submissionId, "123", f.clock.value, 5000),
        ),
      );
      expect(retries.filter((r) => r?.status === "CLAIMED")).toHaveLength(1);
      expect(
        await createSupportRepository(a).find(result.delivery.submissionId, "123"),
      ).toMatchObject({ status: "SENDING", attemptVersion: 2, text: "Message to retry" });
    });
  });
}

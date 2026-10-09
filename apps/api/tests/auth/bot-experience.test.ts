import { describe, expect, it, vi } from "vitest";
import { botOnboardingService } from "../../src/auth/application/bot-onboarding.js";
import { registrationService } from "../../src/users/application/registration.js";
import { ownerAdmissionPolicy } from "../../src/auth/application/owner-admission.js";
import type {
  SupportRepository,
  SupportSubmission,
} from "../../src/auth/application/bot-onboarding-ports.js";
import { botFixture, botContext, acknowledge } from "./bot-onboarding-fixtures.js";
function fixture(testUser?: string) {
  const f = botFixture();
  const completed = new Set<bigint>();
  const submissions = new Map<string, SupportSubmission>();
  const read = async (id: bigint) => {
    const row = f.accountsByTelegram.get(id);
    return row?.status === "ACTIVE"
      ? { userId: row.userId, displayName: row.displayName, completed: completed.has(id) }
      : undefined;
  };
  const complete = vi.fn(async (id: bigint) => {
    completed.add(id);
    return read(id);
  });
  const registration = registrationService({
    repository: { read, complete },
    accounts: f.accounts,
    clock: f.clock,
  });
  const support: SupportRepository = {
    async find(id) {
      return submissions.get(id);
    },
    async pending(botId, id) {
      return [...submissions.values()].find(
        (s) => s.botId === botId && s.telegramUserId === id && s.status !== "DELIVERED",
      );
    },
    async acquire(id, _bot, now, leaseMs) {
      const s = submissions.get(id);
      if (!s) return;
      if (s.status === "SENDING" && s.leaseUntil <= now) s.status = "UNKNOWN";
      if (!["PENDING", "FAILED"].includes(s.status)) return { ...s };
      s.status = "SENDING";
      s.attemptVersion++;
      s.leaseUntil = now + leaseMs;
      return { ...s, status: "CLAIMED" };
    },
    async settle(id, _bot, version, outcome, messageId, continuation) {
      const s = submissions.get(id);
      if (!s || s.attemptVersion !== version) return false;
      s.status = outcome;
      s.deliveryMessageId = messageId ?? null;
      if (continuation) {
        const r = [...f.receipts.values()].find(
          (r) =>
            r.id === continuation.receiptId &&
            r.replyData?.submissionId === id &&
            r.version === continuation.version &&
            r.reply === "SUPPORT_DISPATCH" &&
            r.phase === "REPLY",
        );
        if (r) {
          r.leaseUntil = continuation.now;
          r.version++;
        }
      }
      return true;
    },
  };
  const transition = f.repository.transition;
  f.repository.transition = (claim, now, decide) =>
    transition(claim, now, (r, flow, at) => {
      const next = decide(r, flow, at);
      if (next?.submission) submissions.set(next.submission.id, { ...next.submission });
      return next;
    });
  const deps = {
    ...f.deps,
    registration,
    support,
    ownerAdmission: ownerAdmissionPolicy({
      readOwner: async () => "100",
      readTestUser: async () => testUser,
    }),
    supportTimeoutMs: 60000,
  };
  const service = botOnboardingService(deps);
  let seq = 1;
  const process = (action: string, extra = {}) =>
    service.process(botContext, {
      schemaVersion: 1,
      updateId: seq,
      messageId: seq++ + 1,
      senderId: "100",
      chatId: "100",
      chatType: "private",
      action,
      ...extra,
    });
  async function register() {
    await acknowledge(service, await process("REGISTER", { displayName: "Mehdi" }));
  }
  return { ...f, deps, service, process, register, completed, complete, submissions, support };
}
describe("explicit Persian bot registration and support", () => {
  it("admits a regular tester without registering on start, acknowledges their replies and sends support only to the owner", async () => {
    const f = fixture("101");
    const identity = { senderId: "101", chatId: "101" };
    const start = await f.process("START", identity);
    expect(start).toMatchObject({ delivery: { reply: "CREATE_ACCOUNT", chatId: "101" } });
    expect(await acknowledge(f.service, start)).toMatchObject({ status: "DONE" });
    expect(f.accountsByTelegram.has(101n)).toBe(false);
    expect(f.completed.has(101n)).toBe(false);
    await acknowledge(
      f.service,
      await f.process("REGISTER", { ...identity, displayName: "Tester" }),
    );
    expect(await f.process("PROFILE", identity)).toMatchObject({
      delivery: { data: { profile: { completed: true, displayName: "Tester" } } },
    });
    await acknowledge(f.service, await f.process("SUPPORT", identity));
    const dispatch = await f.process("TEXT", { ...identity, text: "Ordinary tester support" });
    expect(dispatch).toMatchObject({
      status: "SUPPORT",
      delivery: { adminChatId: "100", chatId: "101" },
    });
    if (!dispatch.ok || dispatch.status !== "SUPPORT") throw Error("Expected synthetic support");
    expect(
      await f.service.acknowledge(botContext, {
        schemaVersion: 1,
        kind: "SUPPORT",
        submissionId: dispatch.delivery.submissionId,
        attemptVersion: dispatch.delivery.attemptVersion,
        outcome: "DELIVERED",
        messageId: 901,
      }),
    ).toMatchObject({ status: "DONE" });
    expect(await f.deps.ownerAdmission.telegramId()).toBe("100");
    expect([...f.submissions.values()][0]).toMatchObject({
      telegramUserId: "101",
      adminChatId: "100",
      status: "DELIVERED",
    });
    expect(
      await f.process("REGISTER", { senderId: "102", chatId: "102", displayName: "Denied" }),
    ).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(f.accountsByTelegram.has(102n)).toBe(false);
  });
  it("start creates no profile; explicit registration is durable and idempotent", async () => {
    const f = fixture();
    expect(await f.process("START")).toMatchObject({ delivery: { reply: "CREATE_ACCOUNT" } });
    expect(f.accountsByTelegram.has(100n)).toBe(false);
    await f.register();
    const id = f.accountsByTelegram.get(100n)!.userId;
    await f.register();
    expect(f.accountsByTelegram.get(100n)!.userId).toBe(id);
    expect(await f.process("START")).toMatchObject({ delivery: { reply: "WELCOME_REGISTERED" } });
    expect(await f.process("PROFILE")).toMatchObject({
      delivery: { reply: "PROFILE", data: { profile: { displayName: "Mehdi", completed: true } } },
    });
  });
  it("registration failure keeps the retryable action and does not grant completion", async () => {
    const f = fixture();
    f.complete.mockRejectedValueOnce(new Error("private db failure"));
    expect(await f.process("REGISTER", { displayName: "Mehdi" })).toMatchObject({
      status: "RETRY",
    });
    expect(f.completed.size).toBe(0);
    expect(await f.process("START")).toMatchObject({ delivery: { reply: "CREATE_ACCOUNT" } });
  });
  it("registration and owner admission gate support", async () => {
    const f = fixture();
    expect(await f.process("SUPPORT")).toMatchObject({ delivery: { reply: "CREATE_ACCOUNT" } });
    expect(f.flows.size).toBe(0);
    expect(
      await f.service.process(botContext, {
        schemaVersion: 1,
        updateId: 99,
        messageId: 99,
        senderId: "101",
        chatId: "101",
        chatType: "private",
        action: "REGISTER",
        displayName: "Other",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(f.submissions.size).toBe(0);
  });
  it.each(["START", "CANCEL", "PROFILE", "NAVIGATION", "REGISTER"])(
    "%s exits composition without forwarding",
    async (action) => {
      const f = fixture();
      await f.register();
      await acknowledge(f.service, await f.process("SUPPORT"));
      await f.process(action, action === "REGISTER" ? { displayName: "Mehdi" } : {});
      expect(f.flows.size).toBe(0);
      expect(await f.process("TEXT", { text: "unrelated" })).toMatchObject({ status: "DONE" });
      expect(f.submissions.size).toBe(0);
    },
  );
  it("repeated support taps keep one composition, media and excessive text retain it, expiry never forwards", async () => {
    const f = fixture();
    await f.register();
    await acknowledge(f.service, await f.process("SUPPORT"));
    const id = [...f.flows.values()][0]!.id;
    await acknowledge(f.service, await f.process("SUPPORT"));
    expect([...f.flows.values()][0]!.id).toBe(id);
    expect(await f.process("MEDIA")).toMatchObject({
      delivery: { reply: "SUPPORT_TEXT_REQUIRED" },
    });
    expect(await f.process("TEXT", { text: "x".repeat(3501) })).toMatchObject({
      delivery: { reply: "SUPPORT_TOO_LONG" },
    });
    expect(f.flows.size).toBe(1);
    f.clock.value += 60000;
    expect(await f.process("TEXT", { text: "expired" })).toMatchObject({
      delivery: { reply: "EXPIRED" },
    });
    expect(f.submissions.size).toBe(0);
  });
  it.each(["DELIVERED", "FAILED", "UNKNOWN"] as const)(
    "records %s and survives service restart without false confirmation",
    async (outcome) => {
      const f = fixture();
      await f.register();
      await acknowledge(f.service, await f.process("SUPPORT"));
      const input = {
        schemaVersion: 1,
        updateId: 100,
        messageId: 101,
        senderId: "100",
        chatId: "100",
        chatType: "private",
        action: "TEXT",
        text: "Only this submitted text <unsafe>",
      };
      const sent = await f.service.process(botContext, input);
      expect(sent).toMatchObject({ status: "SUPPORT", delivery: { adminChatId: "100" } });
      if (!sent.ok || sent.status !== "SUPPORT") throw new Error("Expected support attempt");
      expect(sent.delivery.text).toContain(input.text);
      expect(await f.service.process(botContext, input)).toMatchObject({ status: "RETRY" });
      expect(
        await f.service.acknowledge(botContext, {
          schemaVersion: 1,
          kind: "SUPPORT",
          submissionId: sent.delivery.submissionId,
          attemptVersion: sent.delivery.attemptVersion,
          receiptClaim: { receiptId: sent.delivery.receiptId, version: sent.delivery.version },
          outcome,
          ...(outcome === "DELIVERED" ? { messageId: 900 } : {}),
        }),
      ).toMatchObject({ status: "DONE" });
      // Confirmed settlement resumes immediately, without advancing the clock.
      const restarted = botOnboardingService(f.deps);
      const resumed = await restarted.process(botContext, input);
      expect(resumed).toMatchObject({
        delivery: {
          reply:
            outcome === "DELIVERED"
              ? "SUPPORT_SENT"
              : outcome === "FAILED"
                ? "SUPPORT_FAILED"
                : "SUPPORT_UNKNOWN",
        },
      });
      expect(f.submissions.size).toBe(1);
      await acknowledge(restarted, resumed);
      if (outcome === "UNKNOWN")
        expect(await f.process("SUPPORT")).toMatchObject({
          delivery: { reply: "SUPPORT_UNKNOWN" },
        });
      if (outcome === "FAILED")
        expect(await f.process("SUPPORT")).toMatchObject({
          status: "SUPPORT",
          delivery: { submissionId: sent.delivery.submissionId, attemptVersion: 2 },
        });
    },
  );
  it("missing or unverified support destination fails closed", async () => {
    const f = fixture();
    await f.register();
    const { ownerAdmission: _owner, ...withoutOwner } = f.deps;
    const service = botOnboardingService(withoutOwner);
    expect(
      await service.process(botContext, {
        schemaVersion: 1,
        updateId: 80,
        messageId: 81,
        senderId: "100",
        chatId: "100",
        chatType: "private",
        action: "SUPPORT",
      }),
    ).toMatchObject({ delivery: { reply: "SUPPORT_UNAVAILABLE" } });
    expect(f.submissions.size).toBe(0);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@hambazi/database";
import { createErrorEnvelope } from "@hambazi/contracts";
import { createBotOnboarding } from "../../src/auth/index.js";
import {
  createAccountCreationPort,
  createUserIdentityPort,
  type AccountCreationPort,
} from "../../src/users/index.js";
import { createBotOnboardingRepository } from "../../src/auth/infrastructure/repositories/bot-onboarding.js";
import {
  FLOW_LIFETIME_MS,
  RECEIPT_LIFETIME_MS,
} from "../../src/auth/application/bot-onboarding-ports.js";
import { botContext, update, acknowledge } from "../auth/bot-onboarding-fixtures.js";

export function botOnboardingIntegrationCases(admin: ReturnType<typeof createDatabase>) {
  describe("durable Bot onboarding against PostgreSQL", () => {
    const config = {
      poolMax: 8,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      transactionMaxWaitMs: 5000,
      transactionTimeoutMs: 5000,
    };
    const a = createDatabase({
      ...config,
      databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
    });
    const b = createDatabase({
      ...config,
      databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
    });
    beforeAll(async () => {
      await Promise.all([a.connect(), b.connect()]);
    });
    afterAll(async () => {
      await Promise.all([a.disconnect(), b.disconnect()]);
    });
    let sequence = 10000;
    function setup() {
      const senderId = String(++sequence);
      const clock = {
        value: Date.UTC(2026, 8, 21),
        nowMs() {
          return this.value;
        },
      };
      const accountPort = createAccountCreationPort(a);
      const create = vi.fn(accountPort.createForVerifiedTelegramIdentity);
      const accounts = { createForVerifiedTelegramIdentity: create };
      const make = (database = a, port: AccountCreationPort = accounts) =>
        createBotOnboarding({
          database,
          accounts: port,
          users: createUserIdentityPort(database),
          clock,
          leaseMs: 5000,
        });
      const service = make();
      const command = (action: Parameters<typeof update>[0]) =>
        update(action, ++sequence, senderId);
      const flow = () =>
        admin.forModule("auth").execute((db) =>
          db.botOnboardingFlow.findUnique({
            where: { botId_telegramUserId: { botId: 123n, telegramUserId: BigInt(senderId) } },
          }),
        );
      const receipts = () =>
        admin.forModule("auth").execute((db) =>
          db.botUpdateReceipt.findMany({
            where: { botId: 123n, telegramUserId: BigInt(senderId) },
            orderBy: { updateId: "asc" },
          }),
        );
      const count = () =>
        admin
          .forModule("users")
          .execute((db) => db.user.count({ where: { telegramUserId: BigInt(senderId) } }));
      const begin = async () => {
        const cmd = command("CREATE");
        const result = await service.process(botContext, cmd);
        expect(await acknowledge(service, result)).toMatchObject({ status: "DONE" });
        return cmd;
      };
      return {
        senderId,
        clock,
        create,
        accounts,
        make,
        service,
        command,
        flow,
        receipts,
        count,
        begin,
      };
    }
    it("persists a private flow and creates once across reconstructed services", async () => {
      const f = setup();
      await f.begin();
      const name = f.command("NAME");
      const result = await f.make(b).process(botContext, name);
      expect(result).toMatchObject({ delivery: { reply: "MENU" } });
      expect(await f.count()).toBe(1);
      expect(await f.flow()).toBeNull();
      expect(await acknowledge(f.service, result)).toMatchObject({ status: "DONE" });
      expect(await f.make(b).process(botContext, name)).toMatchObject({ status: "DONE" });
      expect(f.create).toHaveBeenCalledTimes(1);
      const rows = await f.receipts();
      expect(
        rows.every((r) => r.expiresAt.getTime() - r.receivedAt.getTime() === RECEIPT_LIFETIME_MS),
      ).toBe(true);
      expect(
        JSON.stringify(rows, (_, value) => (typeof value === "bigint" ? String(value) : value)),
      ).not.toContain("Mehdi");
    });
    it("claims one of eight concurrent duplicate creates on two database clients", async () => {
      const f = setup(),
        other = f.make(b),
        cmd = f.command("CREATE");
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => (i % 2 ? f.service : other).process(botContext, cmd)),
      );
      expect(results.filter((r) => r.ok && r.status === "REPLY")).toHaveLength(1);
      expect(results.filter((r) => r.ok && r.status === "RETRY")).toHaveLength(7);
      expect(await f.receipts()).toHaveLength(1);
      const flow = await f.flow();
      expect(flow).not.toBeNull();
      f.clock.value += 5000;
      const resumed = await other.process(botContext, cmd);
      expect(resumed).toMatchObject({ delivery: { version: 2 } });
      expect((await f.flow())!.expiresAt).toEqual(flow!.expiresAt);
      await acknowledge(other, resumed);
    });
    it("serializes competing Create commands without duplicating or extending the conversation", async () => {
      const f = setup(),
        other = f.make(b);
      const commands = Array.from({ length: 8 }, () => f.command("CREATE"));
      const results = await Promise.all(
        commands.map((cmd, i) => (i % 2 ? f.service : other).process(botContext, cmd)),
      );
      expect(results.some((r) => r.ok && r.status === "REPLY")).toBe(true);
      const before = await f.flow();
      f.clock.value += 5000;
      for (const cmd of commands) await other.process(botContext, cmd);
      expect((await f.flow())!.id).toBe(before!.id);
      expect((await f.flow())!.expiresAt).toEqual(before!.expiresAt);
    });
    it("deduplicates eight concurrent name deliveries and their account effect", async () => {
      const f = setup();
      await f.begin();
      const other = f.make(b),
        cmd = f.command("NAME");
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => (i % 2 ? f.service : other).process(botContext, cmd)),
      );
      expect(results.filter((r) => r.ok && r.status === "REPLY")).toHaveLength(1);
      expect(f.create).toHaveBeenCalledTimes(1);
      expect(await f.count()).toBe(1);
    });
    it("fences competing names and cancel while an admitted account operation is running", async () => {
      const f = setup();
      await f.begin();
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const admission = new Promise<void>((r) => {
        entered = r;
      });
      const slow = f.make(a, {
        async createForVerifiedTelegramIdentity(id, name) {
          entered();
          await gate;
          return f.accounts.createForVerifiedTelegramIdentity(id, name);
        },
      });
      const pending = slow.process(botContext, f.command("NAME"));
      await admission;
      try {
        expect((await f.flow())!.state).toBe("SUBMITTING");
        expect(await f.make(b).process(botContext, f.command("NAME"))).toMatchObject({
          status: "RETRY",
        });
        expect(await f.make(b).process(botContext, f.command("CANCEL"))).toMatchObject({
          status: "RETRY",
        });
        // These DB operations complete while Users is paused: Auth holds no transaction over the call.
      } finally {
        release();
      }
      expect(await pending).toMatchObject({ delivery: { reply: "MENU" } });
      expect(f.create).toHaveBeenCalledTimes(1);
    });
    it("cancel before name admission prevents creation, and old prompt replies cannot reach a fresh flow", async () => {
      const f = setup();
      await f.begin();
      const first = (await f.flow())!.id;
      expect(await f.service.process(botContext, f.command("CANCEL"))).toMatchObject({
        delivery: { reply: "CANCELLED" },
      });
      const next = await f.service.process(botContext, f.command("CREATE"));
      await acknowledge(f.service, next, 901);
      expect((await f.flow())!.id).not.toBe(first);
      expect(await f.service.process(botContext, f.command("NAME"))).toMatchObject({
        delivery: { reply: "EXPIRED" },
      });
      expect(await f.count()).toBe(0);
    });
    it("recovers account-commit-before-receipt completion without a second create call", async () => {
      const f = setup();
      await f.begin();
      const cmd = f.command("NAME");
      const interrupted = f.make(a, {
        async createForVerifiedTelegramIdentity(id, name) {
          await f.accounts.createForVerifiedTelegramIdentity(id, name);
          throw new Error("synthetic crash after commit");
        },
      });
      expect(await interrupted.process(botContext, cmd)).toMatchObject({ status: "RETRY" });
      expect(await f.count()).toBe(1);
      expect((await f.flow())!.state).toBe("SUBMITTING");
      f.clock.value += 5000;
      const recovered = await f.make(b).process(botContext, cmd);
      expect(recovered).toMatchObject({ delivery: { reply: "MENU" } });
      expect(f.create).toHaveBeenCalledTimes(1);
      await acknowledge(f.service, recovered);
      expect(await f.flow()).toBeNull();
    });
    it("retries an interrupted pre-commit operation using redelivered text without persisting it", async () => {
      const f = setup();
      await f.begin();
      const cmd = f.command("NAME");
      const interrupted = f.make(a, {
        async createForVerifiedTelegramIdentity() {
          return createErrorEnvelope("INTERNAL_ERROR");
        },
      });
      expect(await interrupted.process(botContext, cmd)).toMatchObject({ status: "RETRY" });
      expect(await f.count()).toBe(0);
      f.clock.value += 5000;
      expect(await f.make(b).process(botContext, cmd)).toMatchObject({
        delivery: { reply: "MENU" },
      });
      expect(await f.count()).toBe(1);
    });
    it("rejects acknowledgements from expired leases and makes completed acknowledgement idempotent", async () => {
      const f = setup(),
        cmd = f.command("CREATE");
      const first = await f.service.process(botContext, cmd);
      f.clock.value += 5000;
      const resumed = await f.make(b).process(botContext, cmd);
      expect(await acknowledge(f.service, first)).toMatchObject({ status: "RETRY" });
      expect(await acknowledge(f.service, resumed, 901)).toMatchObject({ status: "DONE" });
      expect(await acknowledge(f.service, resumed, 902)).toMatchObject({ status: "DONE" });
      expect((await f.flow())!.promptMessageId).toBe(901);
    });
    it("does not let late acknowledgements replace a newer prompt", async () => {
      const f = setup();
      const old = await f.service.process(botContext, f.command("CREATE"));
      const next = await f.make(b).process(botContext, f.command("START"));
      await acknowledge(f.service, next, 902);
      await acknowledge(f.service, old, 901);
      expect((await f.flow())!.promptMessageId).toBe(902);
    });
    it("expires immediately, prevents expired prompt resend and deletes in bounded batches", async () => {
      const f = setup(),
        cmd = f.command("CREATE");
      await f.service.process(botContext, cmd);
      const original = (await f.receipts())[0]!;
      f.clock.value += FLOW_LIFETIME_MS;
      expect(await f.make(b).process(botContext, cmd)).toMatchObject({
        delivery: { reply: "EXPIRED" },
      });
      expect(await f.service.process(botContext, f.command("NAME"))).toMatchObject({
        delivery: { reply: "EXPIRED" },
      });
      expect(await f.count()).toBe(0);
      f.clock.value = original.expiresAt.getTime();
      expect(await f.service.process(botContext, cmd)).toMatchObject({ status: "EXPIRED" });
      // The later unsolicited NAME has its own later seven-day deadline.
      f.clock.value += FLOW_LIFETIME_MS;
      const before = await admin.forModule("auth").execute((db) => db.botUpdateReceipt.count());
      const cleaned = await f.service.cleanup({ schemaVersion: 1, limit: 1 });
      expect(cleaned).toMatchObject({ ok: true, receipts: 1 });
      expect(await admin.forModule("auth").execute((db) => db.botUpdateReceipt.count())).toBe(
        before - 1,
      );
      for (let i = 0; i < 8; i++) await f.service.cleanup({ schemaVersion: 1, limit: 500 });
      expect(await f.service.cleanup({ schemaVersion: 1, limit: 500 })).toMatchObject({
        receipts: 0,
        flows: 0,
      });
      expect(await f.receipts()).toHaveLength(0);
      expect(await f.flow()).toBeNull();
      expect(
        await admin
          .forModule("users")
          .execute((db) => db.user.count({ where: { telegramUserId: { gte: 10000n } } })),
      ).toBeGreaterThan(0);
    });
    it("namespaces update IDs by bot and rejects changed sender metadata", async () => {
      const f = setup(),
        cmd = f.command("START");
      await f.service.process(botContext, cmd);
      expect(await f.service.process({ ...botContext, botId: "456" }, cmd)).toMatchObject({
        delivery: { reply: "CREATE_ACCOUNT" },
      });
      expect(
        await f.service.process(botContext, { ...cmd, senderId: "888888", chatId: "888888" }),
      ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    });
    it("rolls back flow and receipt together when a transition violates database constraints", async () => {
      const f = setup(),
        cmd = f.command("CREATE");
      await f.service.process(botContext, cmd);
      const row = (await f.receipts())[0]!;
      const before = await f.flow();
      await expect(
        createBotOnboardingRepository(a).transition(
          { id: row.id, botId: String(row.botId), version: row.version },
          () => f.clock.value,
          (_, flow) => ({
            phase: "INVALID",
            reply: null,
            flowId: null,
            promptVersion: null,
            flow: { ...flow!, promptVersion: flow!.promptVersion + 1 },
          }),
        ),
      ).rejects.toMatchObject({ code: "DATABASE_OPERATION_FAILED" });
      expect(await f.flow()).toEqual(before);
      expect((await f.receipts())[0]!.phase).toBe("REPLY");
    });
    it("fails closed with unavailable storage and never calls Users creation", async () => {
      const closed = createDatabase({
        ...config,
        databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
      });
      await closed.disconnect();
      const f = setup();
      expect(await f.make(closed).process(botContext, f.command("CREATE"))).toEqual({
        ok: true,
        schemaVersion: 1,
        status: "RETRY",
      });
      expect(f.create).not.toHaveBeenCalled();
    });
    it("prevents a stale processor from admitting creation after another lease has won", async () => {
      const f = setup();
      await f.begin();
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const lookup = new Promise<void>((r) => {
        entered = r;
      });
      const users = createUserIdentityPort(a);
      const delayed = createBotOnboarding({
        database: a,
        accounts: f.accounts,
        clock: f.clock,
        leaseMs: 5000,
        users: {
          ...users,
          async findActiveByTelegramId(id) {
            const result = await users.findActiveByTelegramId(id);
            entered();
            await gate;
            return result;
          },
        },
      });
      const cmd = f.command("NAME");
      const old = delayed.process(botContext, cmd);
      await lookup;
      try {
        f.clock.value += 5000;
        expect(await f.make(b).process(botContext, cmd)).toMatchObject({
          delivery: { reply: "MENU", version: 2 },
        });
      } finally {
        release();
      }
      expect(await old).toMatchObject({ status: "RETRY" });
      expect(f.create).toHaveBeenCalledTimes(1);
      expect(await f.count()).toBe(1);
    });
    it("keeps one account when an already-admitted Users call outlives its receipt lease", async () => {
      const f = setup();
      await f.begin();
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const admission = new Promise<void>((r) => {
        entered = r;
      });
      const delayed = f.make(a, {
        async createForVerifiedTelegramIdentity(id, name) {
          entered();
          await gate;
          return f.accounts.createForVerifiedTelegramIdentity(id, name);
        },
      });
      const cmd = f.command("NAME");
      const old = delayed.process(botContext, cmd);
      await admission;
      try {
        f.clock.value += 5000;
        expect(await f.make(b).process(botContext, cmd)).toMatchObject({
          delivery: { reply: "MENU", version: 2 },
        });
      } finally {
        release();
      }
      expect(await old).toMatchObject({ status: "RETRY" });
      expect(f.create).toHaveBeenCalledTimes(2);
      expect(await f.count()).toBe(1);
    });
    it("rolls back if the lease deadline passes after flow mutation but before completion", async () => {
      const f = setup();
      await f.service.process(botContext, f.command("CREATE"));
      const row = (await f.receipts())[0]!;
      const before = await f.flow();
      let reads = 0;
      await expect(
        createBotOnboardingRepository(a).transition(
          { id: row.id, botId: String(row.botId), version: row.version },
          () => f.clock.value + (++reads >= 4 ? 5000 : 0),
          (_, flow) => ({
            phase: "REPLY",
            reply: "PROMPT_NAME",
            flowId: flow!.id,
            promptVersion: flow!.promptVersion + 1,
            flow: { ...flow!, promptVersion: flow!.promptVersion + 1 },
          }),
        ),
      ).rejects.toMatchObject({ code: "DATABASE_OPERATION_FAILED" });
      expect(await f.flow()).toEqual(before);
      expect((await f.receipts())[0]).toEqual(row);
    });
    it("leaves durable pending reply and conversation probes for the real PostgreSQL restart rehearsal", async () => {
      const f = setup();
      expect(await f.service.process(botContext, f.command("CREATE"))).toMatchObject({
        delivery: { reply: "PROMPT_NAME" },
      });
      expect((await f.flow())!.promptMessageId).toBeNull();
      expect((await f.receipts())[0]!.phase).toBe("REPLY");
    });
  });
}

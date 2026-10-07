import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { Queue } from "bullmq";
import { createDatabase } from "@hambazi/database";
import { createCoupMatchGame } from "../../../api/dist/composition/coup-match.js";
import {
  createMatchAutomationPort,
  createMatchReconnectPort,
  type MatchAutomationPort,
} from "@hambazi/api/matches";
import { startMatchAutomation, matchJobId, type MatchJob } from "../../src/match-automation.js";
import { queueConnection } from "../../src/queue-connection.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
  !process.env.TEST_DATABASE_URL ||
  !process.env.WORKER_DATABASE_URL ||
  !process.env.TEST_WORKER_REDIS_URL
)
  throw new Error("Use isolated test:auth-http:local harness");
const options = {
  poolMax: 4,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
};
const admin = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
});
const database = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
});
const redisUrl = { reveal: () => process.env.TEST_WORKER_REDIS_URL! };
beforeAll(() => Promise.all([admin.connect(), database.connect()]));
afterAll(() => Promise.all([admin.disconnect(), database.disconnect()]));
let serial = 18000000;
async function fixture(bot: boolean) {
  const game = createCoupMatchGame({
    rulesetVersion: "coup-provisional-complete-v1",
    copiesPerRole: 3,
    cardsPerPlayer: 2,
    startingCoins: 2,
    incomeCoins: 1,
    foreignAidCoins: 2,
    coupCost: 7,
    mandatoryCoupAt: 10,
    taxCoins: 3,
    stealCoins: 2,
    assassinationCost: 3,
    actionTimeoutMs: 60000,
    responseTimeoutMs: 60000,
    decisionTimeoutMs: 60000,
  });
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids)
    await admin.forModule("users").execute((db) =>
      db.user.create({
        data: {
          id,
          telegramUserId: BigInt(++serial),
          publicHandle: `automation_${serial}`,
          displayName: "Automation fixture",
          status: "ACTIVE",
        },
      }),
    );
  const matchId = randomUUID();
  const created = Date.now();
  await admin.forModule("matches").transaction(async (db) => {
    await db.match.create({
      data: {
        id: matchId,
        gameId: "coup",
        matchType: "MATCHMAKING",
        status: "ACTIVE",
        engineVersion: game.descriptor.engineVersion,
        stateSchemaVersion: game.descriptor.stateSchemaVersion,
        rulesetVersion: game.descriptor.rulesetVersion,
        stateJsonb: z.record(z.string(), z.json()).parse(game.initialize(ids, created)),
        startedAt: new Date(created),
      },
    });
    for (const [seat, userId] of ids.entries())
      await db.matchPlayer.create({
        data: {
          matchId,
          userId,
          seat,
          agentType: bot ? "BOT" : "HUMAN",
          connectionStatus: bot ? "REPLACED_BY_BOT" : "CONNECTED",
        },
      });
  });
  const policy = { schemaVersion: 1 as const, leaseMs: 500, graceMs: 1200, maxConnections: 4 };
  const clock = { nowMs: () => Date.now() };
  const real = createMatchAutomationPort(database, { clock, games: [game] });
  const automation: MatchAutomationPort = {
    ...real,
    recover: async (input) => {
      const page = await real.recover(input);
      return { ...page, matchIds: page.matchIds.filter((id) => id === matchId) };
    },
  };
  const reconnect = createMatchReconnectPort(database, { clock, policy });
  const namespace = `automation-${randomUUID()}`;
  const queue = new Queue("match-automation-v1", {
    connection: queueConnection(redisUrl, false),
    prefix: `hambazi:jobs:${namespace}`,
  });
  const config = {
    redisUrl,
    namespace,
    intervalMs: 20,
    batchSize: 100,
    attempts: 2,
    backoffMs: 20,
    drainTimeoutMs: 2000,
    automation,
    reconnect,
    event: vi.fn(),
  };
  const read = () =>
    admin
      .forModule("matches")
      .execute((db) => db.match.findUniqueOrThrow({ where: { id: matchId } }));
  const players = () =>
    admin
      .forModule("matches")
      .execute((db) => db.matchPlayer.findMany({ where: { matchId }, orderBy: { seat: "asc" } }));
  async function dispose() {
    await queue.obliterate({ force: true });
    await queue.close();
  }
  return {
    matchId,
    ids,
    policy,
    created,
    real,
    automation,
    reconnect,
    config,
    queue,
    read,
    players,
    dispose,
  };
}
it("lets 64 obsolete jobs finish while eight current Match writer locks are held", async () => {
  const fixtures = await Promise.all(Array.from({ length: 8 }, () => fixture(false)));
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const locked = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let completed = 0;
  let jobs: Promise<unknown>[] = [];
  for (const f of fixtures)
    await admin
      .forModule("matches")
      .execute((db) => db.match.update({ where: { id: f.matchId }, data: { stateVersion: 10 } }));
  const hold = admin.forModule("matches").transaction(async (db) => {
    for (const f of fixtures) await db.lockMatch(f.matchId);
    entered();
    await gate;
  });
  try {
    await locked;
    jobs = fixtures.flatMap((f) =>
      Array.from({ length: 8 }, async () => {
        const result = await f.real.execute({
          schemaVersion: 1,
          matchId: f.matchId,
          expectedStateVersion: 0,
          expectedRevision: 0,
          deadlineAt: f.created,
          kind: "TIMER",
          playerId: null,
          expectedConnectionEpoch: null,
        });
        expect(result).toMatchObject({ stateVersion: 10, lastEventSeq: 0 });
        completed++;
      }),
    );
    // Attach rejection handlers before the assertion, including on the red path.
    const settled = Promise.allSettled(jobs);
    await vi.waitFor(() => expect(completed).toBe(64), { timeout: 1000, interval: 10 });
    expect(await settled).toHaveLength(64);
  } finally {
    release();
    await hold;
    await Promise.allSettled(jobs);
    for (const f of fixtures) {
      expect((await f.read()).stateVersion).toBe(10);
      const counts = await admin.forModule("matches").execute(async (db) => ({
        commands: await db.processedCommand.count({ where: { matchId: f.matchId } }),
        events: await db.gameEvent.count({ where: { matchId: f.matchId } }),
        outbox: await db.outboxEvent.count({ where: { aggregateId: f.matchId } }),
      }));
      expect(counts).toEqual({ commands: 0, events: 0, outbox: 0 });
      await f.dispose();
    }
  }
}, 10000);
it("drives a full bot game through real BullMQ and Worker-role atomic writes", async () => {
  const f = await fixture(true);
  const worker = await startMatchAutomation(f.config);
  try {
    await vi.waitFor(async () => expect((await f.read()).status).toBe("FINISHED"), {
      timeout: 12000,
      interval: 50,
    });
    const completed = await f.read();
    expect(completed.stateVersion).toBeGreaterThan(10);
    const finish = await admin
      .forModule("matches")
      .execute((db) =>
        db.outboxEvent.count({ where: { aggregateId: f.matchId, type: "MATCH_FINISHED_V1" } }),
      );
    expect(finish).toBe(1);
    expect(f.config.event).toHaveBeenCalledWith("worker.job_completed");
  } finally {
    await worker.close();
    await f.dispose();
  }
}, 15000);
it("rebuilds lost delayed jobs after queue loss and worker recreation without extending grace", async () => {
  const f = await fixture(false);
  // In this test keep the engine dormant so assertions isolate presence/job reconstruction.
  const automation = {
    ...f.automation,
    plan: async (id: unknown) => {
      const plan = await f.real.plan(id);
      return plan ? { ...plan, intent: null } : null;
    },
  };
  let worker = await startMatchAutomation({ ...f.config, automation });
  try {
    await vi.waitFor(
      async () =>
        expect((await f.players()).every((p) => p.disconnectDeadlineAt !== null)).toBe(true),
      { timeout: 3000, interval: 20 },
    );
    const deadlines = (await f.players()).map((p) => p.disconnectDeadlineAt!.getTime());
    expect(deadlines).toEqual([f.created + f.policy.graceMs, f.created + f.policy.graceMs]);
    await worker.close();
    await f.queue.obliterate({ force: true });
    worker = await startMatchAutomation({ ...f.config, automation });
    await vi.waitFor(
      async () => expect((await f.players()).every((p) => p.agentType === "BOT")).toBe(true),
      { timeout: 6000, interval: 30 },
    );
    expect((await f.players()).map((p) => p.disconnectDeadlineAt!.getTime())).toEqual(deadlines);
    const takeover = await admin
      .forModule("matches")
      .execute((db) =>
        db.gameEvent.count({ where: { matchId: f.matchId, type: "PLAYER_BOT_TAKEOVER_V1" } }),
      );
    expect(takeover).toBe(2);
  } finally {
    await worker.close();
    await f.dispose();
  }
}, 10000);
it("retries a transient failure, deduplicates jobs and cancels obsolete delayed work", async () => {
  const f = await fixture(true);
  const intent = (await f.real.plan(f.matchId))!.intent!;
  const data: MatchJob = { schemaVersion: 1, kind: "AUTOMATION", payload: intent };
  let calls = 0;
  const execute = vi.fn(async (input: unknown) => {
    if (++calls === 1) throw new Error("SYNTHETIC_PRIVATE_FAILURE");
    return f.real.execute(input);
  });
  const automation = {
    ...f.automation,
    execute,
    recover: async () => ({ matchIds: [], next: null }),
  };
  const worker = await startMatchAutomation({ ...f.config, automation });
  try {
    await Promise.all([worker.schedule(data), worker.schedule(data)]);
    await vi.waitFor(async () => expect((await f.read()).stateVersion).toBe(1), {
      timeout: 5000,
      interval: 20,
    });
    expect(execute).toHaveBeenCalledTimes(2);
    const delayed: MatchJob = {
      schemaVersion: 1,
      kind: "AUTOMATION",
      payload: { ...intent, deadlineAt: Date.now() + 60000 },
    };
    await worker.schedule(delayed);
    expect(await f.queue.getJob(matchJobId(delayed))).toBeDefined();
    await worker.cancel(delayed);
    expect(await f.queue.getJob(matchJobId(delayed))).toBeUndefined();
    await worker.schedule(data);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3), {
      timeout: 3000,
      interval: 20,
    });
    expect((await f.read()).stateVersion).toBe(1);
  } finally {
    await worker.close();
    await f.dispose();
  }
}, 10000);

it("bounds drain when an admitted application job cannot finish", async () => {
  const f = await fixture(true);
  const intent = (await f.real.plan(f.matchId))!.intent!;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = vi.fn(async () => {
    await blocked;
    return {} as never;
  });
  const automation = {
    ...f.automation,
    execute,
    recover: async () => ({ matchIds: [], next: null }),
  };
  const worker = await startMatchAutomation({ ...f.config, automation, drainTimeoutMs: 100 });
  try {
    await worker.schedule({ schemaVersion: 1, kind: "AUTOMATION", payload: intent });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1), {
      timeout: 3000,
      interval: 20,
    });
    await expect(worker.close()).rejects.toThrow("Match automation drain deadline");
    await expect(
      worker.schedule({ schemaVersion: 1, kind: "AUTOMATION", payload: intent }),
    ).rejects.toThrow("Match automation closed");
    expect((await f.read()).stateVersion).toBe(0);
  } finally {
    release();
    await worker.close().catch(() => {});
    await f.dispose();
  }
});

import { randomUUID } from "node:crypto";
import { fork, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { beforeAll, afterAll, it, expect } from "vitest";
import { createDatabase } from "@hambazi/database";
import {
  createMatchResultPort,
  createMatchOutboxPort,
  matchDomainEventSchema,
} from "@hambazi/api/matches";
import { createStatisticsProjection } from "@hambazi/api/leaderboard";
import { createKahrobaMatchGame } from "@hambazi/api";
import { createMatchAutomationPort, createMatchResyncPort } from "@hambazi/api/matches";
import {
  createBullMqDomainPublisher,
  createOutboxDispatcher,
  decodeDelivery,
} from "../../src/outbox-dispatcher.js";
import { rebuildStatistics } from "../../src/statistics.js";
import {
  kahrobaFixture,
  installSharedFinalRound,
  kahrobaRules,
} from "../../../api/tests/fixtures/kahroba.js";
if (
  process.env.TEST_KAHROBA_RUN !== "isolated-k2" ||
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  !process.env.API_DATABASE_URL ||
  !process.env.WORKER_DATABASE_URL ||
  !process.env.TEST_WORKER_REDIS_URL
)
  throw new Error("Use test:kahroba:local");
const options = {
  poolMax: 8,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 10000,
};
const api = createDatabase({
    ...options,
    databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
  }),
  worker = createDatabase({
    ...options,
    databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
  });
beforeAll(() => Promise.all([api.connect(), worker.connect()]));
afterAll(() => Promise.all([api.disconnect(), worker.disconnect()]));
it("recovers v2 finish jobs after a Worker crash, credits both winners once, and rebuilds identically", async () => {
  const f = await kahrobaFixture(api, api),
    matchId = await f.active(),
    commands = await installSharedFinalRound(f);
  for (let i = 0; i < 2; i++) {
    const row = (await f.stored()).match;
    expect(
      (
        await f.first.privateRooms.command(f.ids[i], {
          ...f.request(matchId, row.stateVersion),
          command: commands[i],
        })
      ).ok,
    ).toBe(true);
  }
  const saved = await f.stored(),
    outbox = saved.outbox.find((e) => e.type === "MATCH_FINISHED_V2")!;
  const event = matchDomainEventSchema.parse({
    schemaVersion: 2,
    eventId: outbox.id,
    aggregateId: matchId,
    occurredAt: outbox.createdAt.getTime(),
    type: outbox.type,
    payload: outbox.payloadJsonb,
    correlation: {},
  });
  if (event.type !== "MATCH_FINISHED_V2") throw new Error("Expected v2 finish");
  const namespace = `kahroba_${randomUUID()}`,
    redisUrl = { reveal: () => process.env.TEST_WORKER_REDIS_URL! };
  const statistics = createStatisticsProjection(worker, { nowMs: () => Date.now() }),
    matches = createMatchResultPort(worker);
  async function counts() {
    return worker.forModule("leaderboard").execute(async (db) => {
      const head = await db.statsHead.findUniqueOrThrow({ where: { id: "statistics-v1" } });
      return db.statsValue.findMany({
        where: { generationId: head.activeId, gameId: "kahroba", userId: { in: f.ids } },
        orderBy: [{ userId: "asc" }, { metric: "asc" }, { period: "asc" }],
        select: { userId: true, gameId: true, metric: true, period: true, value: true },
      });
    });
  }
  const publisher = await createBullMqDomainPublisher({
    redisUrl,
    namespace,
    timeoutMs: 2000,
    attempts: 3,
    backoffMs: 100,
    event: () => {},
  });
  async function launch() {
    const child = fork(new URL("../fixtures/kahroba-statistics.mjs", import.meta.url), [], {
      env: { ...process.env, TEST_KAHROBA_NAMESPACE: namespace },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Worker readiness")), 10000);
      child.once("message", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Worker exit"));
      });
    });
    return child;
  }
  let child = await launch();
  try {
    child.kill("SIGKILL");
    await once(child, "exit");
    await publisher.publish(event);
    child = await launch();
    await expect
      .poll(
        async () => {
          const rows = await counts();
          return rows
            .filter((r) => r.metric === "wins" && r.period === "all_time")
            .map((r) => r.value);
        },
        { timeout: 10000 },
      )
      .toEqual([1n, 1n]);
    const first = await counts();
    expect(first.filter((r) => r.metric === "completed").every((r) => r.value === 1n)).toBe(true);
    expect(await statistics.consume(await matches.record(event))).toBe("DUPLICATE");
    await publisher.publish(event);
    child.send("close");
    await once(child, "exit");
    child = await launch();
    await publisher.publish(event);
    await expect.poll(async () => await counts(), { timeout: 10000 }).toEqual(first);
    await rebuildStatistics(matches, statistics);
    expect(await counts()).toEqual(first);
    expect((await f.stored()).result).toEqual(saved.result);
    expect((await f.stored()).results).toEqual(saved.results);
    let cursor: string | null = null;
    let found = false;
    do {
      const page = await matches.page(cursor, 25);
      found ||= page.results.some(
        (r) => r.payload.matchId === matchId && r.payload.schemaVersion === 2,
      );
      cursor = page.next;
    } while (cursor);
    expect(found).toBe(true);
    await expect(
      statistics.consume({
        ...(await matches.record(event)),
        eventId: randomUUID(),
        payload: {
          ...event.payload,
          result: {
            ...event.payload.result,
            metrics: { ...event.payload.result.metrics, turnsPlayed: 999 },
          },
        },
      }),
    ).rejects.toThrow();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.send("close");
      await once(child, "exit");
    }
    await publisher.close();
  }
}, 45000);
it("retains outbox truth through actual Redis failure and redrives a v2 result safely", async () => {
  const f = await kahrobaFixture(api, api),
    matchId = await f.active(),
    commands = await installSharedFinalRound(f);
  for (let i = 0; i < 2; i++) {
    const row = (await f.stored()).match;
    expect(
      (
        await f.first.processing.command(f.ids[i], {
          ...f.request(matchId, row.stateVersion),
          command: commands[i],
        })
      ).ok,
    ).toBe(true);
  }
  const saved = await f.stored(),
    event = saved.outbox.find((e) => e.type === "MATCH_FINISHED_V2")!;
  const clock = { nowMs: () => Date.now() },
    outbox = createMatchOutboxPort(worker, {
      clock,
      policy: { leaseMs: 10000, maxAttempts: 3, backoffMs: 100, maxBackoffMs: 1000 },
      decode: decodeDelivery,
    });
  const namespace = `kahroba_${randomUUID()}`,
    publisher = await createBullMqDomainPublisher({
      redisUrl: { reveal: () => process.env.TEST_WORKER_REDIS_URL! },
      namespace,
      timeoutMs: 500,
      attempts: 3,
      backoffMs: 100,
      event: () => {},
    });
  const dispatcher = createOutboxDispatcher({
    outbox,
    publisher,
    batchSize: 100,
    publishTimeoutMs: 1000,
    event: () => {},
  });
  const name = process.env.TEST_AUTH_REDIS_CONTAINER!;
  if (!name.startsWith("hambazi-auth-http-")) throw new Error("Not disposable Redis");
  try {
    await promisify(execFile)("docker", ["stop", "--time", "1", name]);
    await dispatcher.runOnce();
    const during = await f.stored();
    expect(during.result).toEqual(saved.result);
    expect(during.match.stateJsonb).toEqual(saved.match.stateJsonb);
    expect(during.outbox.find((e) => e.id === event.id)!.status).toBe("PENDING");
  } finally {
    await promisify(execFile)("docker", ["start", name]);
  }
  try {
    await expect
      .poll(
        async () => {
          try {
            return await publisher.probe!();
          } catch {
            return false;
          }
        },
        { timeout: 10000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () => {
          await dispatcher.runOnce();
          return (await f.stored()).outbox.find((e) => e.id === event.id)!.status;
        },
        { timeout: 10000 },
      )
      .toBe("PUBLISHED");
    const recorded = await createMatchResultPort(worker).record({
      schemaVersion: 2,
      eventId: event.id,
      aggregateId: matchId,
      occurredAt: event.createdAt.getTime(),
      type: event.type,
      payload: event.payloadJsonb,
      correlation: {},
    });
    const projection = createStatisticsProjection(worker, clock);
    expect(await projection.consume(recorded)).toBe("APPLIED");
    expect(await projection.consume(recorded)).toBe("DUPLICATE");
    expect(await outbox.redrive(event.id)).toBe(true);
    await dispatcher.runOnce();
    expect((await f.stored()).results).toEqual(saved.results);
  } finally {
    await dispatcher.close();
    await publisher.close();
  }
}, 30000);
it("plans no human timer and resumes explicit bot work with the existing version/epoch guards", async () => {
  const f = await kahrobaFixture(api, api),
    matchId = await f.active(),
    game = createKahrobaMatchGame(kahrobaRules);
  const automation = createMatchAutomationPort(worker, { clock: f.clock, games: [game] });
  expect((await automation.plan(matchId))?.intent).toBeNull();
  // Simulate an already committed existing takeover; no unapproved timeout is executed.
  const initial = await f.stored();
  const state = initial.match.stateJsonb as { players: { id: string }[]; turnPlayerIndex: number };
  const actor = state.players[state.turnPlayerIndex]!.id;
  expect(
    (
      await f.first.processing.command(actor, {
        ...f.request(matchId, initial.match.stateVersion),
        command: { type: "RESERVE_CARD", source: { kind: "DECK", tier: 1 } },
      })
    ).ok,
  ).toBe(true);
  const next = await f.stored();
  const nextState = next.match.stateJsonb as { players: { id: string }[]; turnPlayerIndex: number };
  expect(
    (
      await f.first.processing.command(nextState.players[nextState.turnPlayerIndex]!.id, {
        ...f.request(matchId, next.match.stateVersion),
        command: {
          type: "TAKE_TOKENS",
          selection: { mode: "DISTINCT", colors: ["diamond", "sapphire", "emerald"] },
        },
      })
    ).ok,
  ).toBe(true);
  await api.forModule("matches").execute((db) =>
    db.matchPlayer.update({
      where: { matchId_userId: { matchId, userId: actor } },
      data: { agentType: "BOT", connectionStatus: "REPLACED_BY_BOT", replacedAt: new Date() },
    }),
  );
  const spectator = await createMatchResyncPort(api, [game]).snapshot(actor, {
    schemaVersion: 1,
    matchId,
  });
  expect(spectator).toMatchObject({
    ok: true,
    value: { role: "SPECTATOR", view: { kind: "SPECTATOR" } },
  });
  expect(JSON.stringify(spectator)).not.toMatch(
    /"myReserved"|"purchaseOptions"|"legalCommands"|"decks"|"unusedNobles"/,
  );
  const plan = await automation.plan(matchId);
  expect(plan?.intent?.kind).toBe("BOT");
  if (!plan?.intent) throw new Error();
  const first = await automation.execute(plan.intent);
  const restarted = createMatchAutomationPort(worker, { clock: f.clock, games: [game] });
  await restarted.execute(plan.intent);
  expect((await f.stored()).match.stateVersion).toBe(first.stateVersion);
  expect(
    (
      await f.first.processing.command(actor, {
        ...f.request(matchId, first.stateVersion),
        command: { type: "PASS" },
      })
    ).ok,
  ).toBe(false);
});

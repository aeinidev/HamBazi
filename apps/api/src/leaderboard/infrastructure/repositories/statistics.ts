import { randomUUID, hash } from "node:crypto";
import { z } from "zod";
import type { createDatabase } from "@hambazi/database";
import { periodKey, statsFinishSchema, type StatsFinish } from "../../application/contracts.js";
const headId = "statistics-v1";
function statsScope(database: ReturnType<typeof createDatabase>) {
  return database.forModule("leaderboard");
}
type Client = Parameters<Parameters<ReturnType<typeof statsScope>["transaction"]>[0]>[0];
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
async function project(db: Client, generationId: string, input: StatsFinish) {
  const p = input.payload;
  const digest = hash("sha256", canonical(p));
  const applied = await db.statsApplication.findUnique({
    where: { generationId_matchId: { generationId, matchId: p.matchId } },
  });
  if (applied) {
    if (applied.digest !== digest) throw new Error("Statistics result conflict");
    return;
  }
  await db.statsApplication.create({ data: { generationId, matchId: p.matchId, digest } });
  for (const period of ["all_time", periodKey("weekly", p.finishedAt)])
    for (const seat of p.result.placements)
      for (const metric of ["completed", "wins"] as const) {
        const key = { generationId, userId: seat.playerId, gameId: p.gameId, metric, period };
        const amount = metric === "completed" || p.result.winnerId === seat.playerId ? 1n : 0n;
        await db.statsValue.upsert({
          where: { generationId_userId_gameId_metric_period: key },
          create: {
            generationId,
            userId: seat.playerId,
            gameId: p.gameId,
            metric,
            period,
            value: amount,
          },
          update: { value: { increment: amount } },
        });
      }
}
export function createStatisticsRepository(
  database: ReturnType<typeof createDatabase>,
  clock: { nowMs(): number },
) {
  const scope = statsScope(database);
  async function head(db: Client) {
    await db.lockStatistics();
    return db.statsHead.findUniqueOrThrow({ where: { id: headId } });
  }
  return Object.freeze({
    consume(input: unknown) {
      const parsed = statsFinishSchema.parse(input);
      return scope.consumeOnce("statistics-v1", parsed.eventId, async (db) => {
        const current = await head(db);
        await project(db, current.activeId, parsed);
        if (current.buildingId) await project(db, current.buildingId, parsed);
      });
    },
    async begin() {
      return scope.transaction(async (db) => {
        const current = await head(db);
        if (current.buildingId) throw new Error("Rebuild already active");
        const id = randomUUID();
        const at = clock.nowMs();
        periodKey("all_time", at);
        await db.statsGeneration.create({
          data: { id, status: "BUILDING", createdAt: new Date(at) },
        });
        await db.statsHead.update({ where: { id: headId }, data: { buildingId: id } });
        return id;
      });
    },
    async applyBatch(id: string, inputs: readonly unknown[]) {
      z.uuid().parse(id);
      if (inputs.length > 25) throw new Error("Invalid rebuild batch");
      const parsed = inputs.map((i) => statsFinishSchema.parse(i));
      await scope.transaction(async (db) => {
        const current = await head(db);
        if (current.buildingId !== id) throw new Error("Stale rebuild");
        for (const input of parsed) await project(db, id, input);
      });
    },
    async finish(id: string) {
      z.uuid().parse(id);
      await scope.transaction(async (db) => {
        const current = await head(db);
        if (current.buildingId !== id) throw new Error("Stale rebuild");
        await db.statsGeneration.update({
          where: { id: current.activeId },
          data: { status: "RETIRED" },
        });
        await db.statsGeneration.update({ where: { id }, data: { status: "ACTIVE" } });
        await db.statsHead.update({
          where: { id: headId },
          data: { activeId: id, buildingId: null },
        });
      });
    },
    async abort(id: string) {
      z.uuid().parse(id);
      await scope.transaction(async (db) => {
        const current = await head(db);
        if (current.buildingId !== id) throw new Error("Stale rebuild");
        await db.statsGeneration.update({ where: { id }, data: { status: "FAILED" } });
        await db.statsHead.update({ where: { id: headId }, data: { buildingId: null } });
      });
    },
    async building() {
      return scope.execute(
        async (db) => (await db.statsHead.findUniqueOrThrow({ where: { id: headId } })).buildingId,
      );
    },
    async own(userId: string, period: string) {
      // Head and values are read in one repeatable snapshot; a cutover cannot mix generations.
      return scope.transaction(async (db) => {
        const current = await db.statsHead.findUniqueOrThrow({ where: { id: headId } });
        const rows = await db.statsValue.findMany({
          where: { generationId: current.activeId, userId, period },
          orderBy: { gameId: "asc" },
          take: 201,
        });
        if (rows.length > 200) throw new Error("Statistics bounds exceeded");
        const games = [...new Set(rows.map((r) => r.gameId))].map((gameId) => {
          const completed =
            rows.find((r) => r.gameId === gameId && r.metric === "completed")?.value ?? 0n;
          const wins = rows.find((r) => r.gameId === gameId && r.metric === "wins")?.value ?? 0n;
          if (wins > completed) throw new Error("Invalid statistics");
          return {
            gameId,
            completed: completed.toString(),
            wins: wins.toString(),
            losses: (completed - wins).toString(),
          };
        });
        return games;
      }, "Serializable");
    },
    async board(gameId: string, period: string, offset: number, limit: number) {
      return scope.transaction(async (db) => {
        const current = await db.statsHead.findUniqueOrThrow({ where: { id: headId } });
        const rows = await db.statsValue.findMany({
          where: { generationId: current.activeId, gameId, period, metric: "wins" },
          orderBy: [{ value: "desc" }, { userId: "asc" }],
          skip: offset,
          take: limit + 1,
        });
        const entries = [];
        for (const row of rows.slice(0, limit))
          entries.push({
            userId: row.userId,
            wins: row.value.toString(),
            rank: String(
              1 +
                (await db.statsValue.count({
                  where: {
                    generationId: current.activeId,
                    gameId,
                    period,
                    metric: "wins",
                    value: { gt: row.value },
                  },
                })),
            ),
          });
        return {
          entries,
          nextOffset: rows.length > limit && offset + limit <= 1000000 ? offset + limit : null,
        };
      }, "Serializable");
    },
  });
}

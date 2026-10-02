import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { createDatabase } from "@hambazi/database";
import { matchFinishedInputSchema, type FinishedResult } from "../../application/result-input.js";
import { matchDomainEventSchema } from "../../application/outbox.js";

function matchScope(
  database: ReturnType<typeof createDatabase>,
): ReturnType<typeof database.forModule<"matches">> {
  return database.forModule("matches");
}
type Client = Parameters<Parameters<ReturnType<typeof matchScope>["transaction"]>[0]>[0];
// The owning repository passes its already validated transaction client.
export async function persistMatchResult(
  db: Pick<Client, "matchResult" | "gameResult">,
  eventId: string,
  payload: FinishedResult,
) {
  const previous = await db.matchResult.findUnique({ where: { matchId: payload.matchId } });
  if (previous) {
    if (previous.eventId !== eventId || !isDeepStrictEqual(previous.payloadJsonb, payload))
      throw new Error("Result conflict");
    return;
  }
  for (const p of payload.result.placements)
    await db.gameResult.createMany({
      data: [
        {
          matchId: payload.matchId,
          userId: p.playerId,
          gameId: payload.gameId,
          placement: p.place,
          winner: payload.result.winnerId === p.playerId,
          schemaVersion: 1,
          metricsJsonb: payload.result.metrics,
          createdAt: new Date(payload.finishedAt),
        },
      ],
      skipDuplicates: true,
    });
  const seats = await db.gameResult.findMany({ where: { matchId: payload.matchId } });
  if (
    seats.length !== payload.result.placements.length ||
    seats.some((row) => {
      const p = payload.result.placements.find((p) => p.playerId === row.userId);
      return (
        !p ||
        row.gameId !== payload.gameId ||
        row.placement !== p.place ||
        row.winner !== (row.userId === payload.result.winnerId) ||
        row.schemaVersion !== 1 ||
        row.createdAt.getTime() !== payload.finishedAt ||
        !isDeepStrictEqual(row.metricsJsonb, payload.result.metrics)
      );
    })
  )
    throw new Error("Result conflict");
  await db.matchResult.create({
    data: { matchId: payload.matchId, eventId, payloadJsonb: payload },
  });
}
export function createMatchResultRepository(database: ReturnType<typeof createDatabase>) {
  const scope = matchScope(database);
  async function record(input: unknown) {
    const event = matchDomainEventSchema.parse(input);
    if (event.type !== "MATCH_FINISHED_V1") throw new Error("Invalid result input");
    return scope.transaction(async (db) => {
      await db.lockMatch(event.aggregateId);
      const row = await db.match.findUniqueOrThrow({ where: { id: event.aggregateId } });
      const stored = await db.outboxEvent.findUniqueOrThrow({ where: { id: event.eventId } });
      const payload = event.payload;
      if (
        stored.type !== event.type ||
        stored.aggregateId !== payload.matchId ||
        stored.schemaVersion !== 1 ||
        !isDeepStrictEqual(stored.payloadJsonb, payload) ||
        row.status !== "FINISHED" ||
        row.gameId !== payload.gameId ||
        row.stateVersion !== payload.stateVersion ||
        row.lastEventSeq !== payload.lastEventSeq ||
        row.finishedAt?.getTime() !== payload.finishedAt ||
        row.engineVersion !== payload.engineVersion ||
        row.stateSchemaVersion !== payload.stateSchemaVersion ||
        row.rulesetVersion !== payload.rulesetVersion
      )
        throw new Error("Invalid durable result");
      const players = await db.matchPlayer.findMany({
        where: { matchId: payload.matchId },
        select: { userId: true },
      });
      if (
        players.length !== payload.result.placements.length ||
        players.some((p) => !payload.result.placements.some((r) => r.playerId === p.userId))
      )
        throw new Error("Invalid result roster");
      await persistMatchResult(db, event.eventId, payload);
      return { eventId: event.eventId, payload };
    });
  }
  return Object.freeze({
    async record(input: unknown) {
      try {
        return await record(input);
      } catch {
        throw new Error("Match result unavailable");
      }
    },
    async recoverPage(after: string | null, limit: number) {
      if (
        (after !== null && !z.uuid().safeParse(after).success) ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 25
      )
        throw new Error("Invalid result page");
      const rows = await scope.execute((db) =>
        db.outboxEvent.findMany({
          where: {
            type: "MATCH_FINISHED_V1",
            id: { gt: after ?? "00000000-0000-0000-0000-000000000000" },
          },
          orderBy: { id: "asc" },
          take: limit,
        }),
      );
      for (const row of rows)
        await record({
          schemaVersion: row.schemaVersion,
          eventId: row.id,
          aggregateId: row.aggregateId,
          occurredAt: row.createdAt.getTime(),
          type: row.type,
          payload: row.payloadJsonb,
          correlation: {
            ...(row.requestId ? { requestId: row.requestId } : {}),
            ...(row.traceparent ? { traceparent: row.traceparent } : {}),
          },
        });
      return { next: rows.length ? rows.at(-1)!.id : null };
    },
    async page(after: string | null, limit: number) {
      if (
        (after !== null && !/^[1-9][0-9]{0,18}$/.test(after)) ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 25
      )
        throw new Error("Invalid result page");
      const rows = await scope.execute((db) =>
        db.matchResult.findMany({
          where: { ordinal: { gt: after ? BigInt(after) : 0n } },
          orderBy: { ordinal: "asc" },
          take: limit,
        }),
      );
      return {
        results: rows.map((r) => ({
          eventId: r.eventId,
          payload: matchFinishedInputSchema.parse(r.payloadJsonb),
        })),
        next: rows.length ? rows.at(-1)!.ordinal.toString() : null,
      };
    },
  });
}

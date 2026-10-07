import { persistMatchResult } from "./results.js";
import {
  matchFinishedInputSchema,
  standardResultInputSchema,
} from "../../application/result-input.js";
import type { MatchCorrelation } from "../../application/correlation.js";
import type { z } from "zod";
import { hash, randomUUID } from "node:crypto";
import { DatabaseError, type createDatabase } from "@hambazi/database";
import { canTransition, matchStatuses, type MatchStatus } from "../../domain/lifecycle.js";
import {
  MatchFault,
  matchAckSchema,
  type MatchGame,
  type MatchRequest,
  type MatchProcessingRepository,
  type MatchAck,
} from "../../application/processing.js";

// Canonical object ordering binds retries to the same intent without storing private commands.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
// JSON conversion also detaches engine objects from the persistence layer.
function json(value: unknown) {
  const text = JSON.stringify(value);
  if (text === undefined) throw new MatchFault("INTERNAL_ERROR");
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new MatchFault("INTERNAL_ERROR");
  return parsed as Record<string, z.infer<ReturnType<typeof z.json>>>;
}
export function createMatchProcessingRepository(
  database: ReturnType<typeof createDatabase>,
  options: {
    clock: { nowMs(): number };
    games: readonly MatchGame[];
  },
): MatchProcessingRepository {
  const scope = database.forModule("matches");
  const games = [...options.games];
  const keys = games.map(
    (game) =>
      `${game.gameId}/${game.descriptor.engineVersion}/${game.descriptor.stateSchemaVersion}/${game.descriptor.rulesetVersion}`,
  );
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate Match engine registration");
  type Client = Parameters<Parameters<typeof scope.transaction>[0]>[0];
  const conflict = () => new MatchFault("GAME_STATE_CONFLICT");
  async function apply(
    db: Client,
    actor: string | null,
    request: MatchRequest,
    correlation: MatchCorrelation,
  ): Promise<MatchAck> {
    await db.lockMatch(request.matchId);
    const found = await db.match.findUnique({ where: { id: request.matchId } });
    if (!found) throw new MatchFault("NOT_FOUND");
    const row = found;
    const players = await db.matchPlayer.findMany({
      where: { matchId: row.id },
      orderBy: { seat: "asc" },
    });
    const player = players.find((seat) => seat.userId === actor);
    if (
      actor !== null &&
      (!player ||
        player.agentType !== "HUMAN" ||
        player.replacedAt !== null ||
        player.connectionStatus === "REPLACED_BY_BOT")
    )
      throw new MatchFault("FORBIDDEN");
    if ((actor === null) !== (request.kind === "LIFECYCLE" || request.kind === "AUTOMATION"))
      throw new MatchFault("FORBIDDEN");
    if (request.kind === "AUTOMATION") {
      const intent = request.intent;
      const seat = players.find((p) => p.userId === intent.playerId);
      if (
        row.status !== "ACTIVE" ||
        row.stateVersion !== intent.expectedStateVersion ||
        (intent.kind === "BOT" &&
          (!seat ||
            seat.agentType !== "BOT" ||
            seat.connectionEpoch !== intent.expectedConnectionEpoch))
      )
        return {
          schemaVersion: 1,
          matchId: row.id,
          actionId: request.actionId,
          stateVersion: row.stateVersion,
          lastEventSeq: row.lastEventSeq,
          status: row.status as MatchStatus,
        };
    }
    const digest = hash("sha256", canonical(request));
    const previous = await db.processedCommand.findUnique({
      where: { matchId_actionId: { matchId: row.id, actionId: request.actionId } },
    });
    if (previous) {
      if (
        previous.actorUserId !== actor ||
        previous.requestDigest !== digest ||
        previous.expectedVersion !== request.expectedVersion
      )
        throw conflict();
      const ack = matchAckSchema.safeParse(previous.resultJsonb);
      if (
        !ack.success ||
        ack.data.matchId !== row.id ||
        ack.data.actionId !== request.actionId ||
        ack.data.stateVersion !== previous.resultingVersion
      )
        throw new MatchFault("INTERNAL_ERROR");
      return ack.data;
    }
    if (
      row.stateVersion !== request.expectedVersion ||
      row.stateVersion >= 2147483647 ||
      !matchStatuses.includes(row.status as MatchStatus)
    )
      throw conflict();
    const at = options.clock.nowMs();
    if (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000)
      throw new MatchFault("INTERNAL_ERROR");
    let resultInput: unknown = null;
    let status = row.status as MatchStatus;
    let state = row.stateJsonb;
    let startedAt = row.startedAt;
    let finishedAt = row.finishedAt;
    const events: { type: string; schemaVersion: number; payload: unknown }[] = [];
    function transition(to: MatchStatus) {
      if (!canTransition(status, to)) throw conflict();
      events.push({
        type: "MATCH_LIFECYCLE_V1",
        schemaVersion: 1,
        payload: { from: status, to, occurredAt: at },
      });
      status = to;
    }
    function game() {
      const selected = games.find(
        (candidate) =>
          candidate.gameId === row.gameId &&
          candidate.descriptor.engineVersion === row.engineVersion &&
          candidate.descriptor.stateSchemaVersion === row.stateSchemaVersion &&
          candidate.descriptor.rulesetVersion === row.rulesetVersion,
      );
      if (!selected) throw new MatchFault("INCOMPATIBLE_GAME_VERSION");
      return selected;
    }
    const ids = players.map((p) => p.userId);
    if (players.length < 2 || players.some((p, i) => p.seat !== i)) throw conflict();
    if (request.kind === "READY") {
      if (status !== "WAITING_FOR_PLAYERS" || !player || player.readyAt !== null) throw conflict();
      await db.matchPlayer.update({
        where: { matchId_userId: { matchId: row.id, userId: player.userId } },
        data: { readyAt: new Date(at) },
      });
      events.push({
        type: "MATCH_PLAYER_READY_V1",
        schemaVersion: 1,
        payload: { userId: player.userId, occurredAt: at },
      });
      if (players.every((p) => p.userId === actor || p.readyAt !== null)) transition("READY");
    } else if (request.kind === "LIFECYCLE") {
      if (request.operation === "WAIT") transition("WAITING_FOR_PLAYERS");
      else if (request.operation === "START") {
        if (!players.every((p) => p.readyAt !== null)) throw conflict();
        game();
        transition("STARTING");
      } else if (request.operation === "ACTIVATE") {
        if (status !== "STARTING" || state !== null) throw conflict();
        const adapter = game();
        state = json(adapter.restore(adapter.initialize(ids, at), ids));
        events.push({
          type: "MATCH_INITIALIZED_V1",
          schemaVersion: 1,
          payload: { snapshot: state },
        });
        transition("ACTIVE");
        startedAt = new Date(at);
      } else {
        transition("TERMINATED");
        finishedAt = new Date(at);
      }
    } else {
      if (status !== "ACTIVE" || state === null) throw conflict();
      const adapter = game();
      const restored = adapter.restore(state, ids);
      if (request.kind === "AUTOMATION" && !adapter.automate)
        throw new MatchFault("INCOMPATIBLE_GAME_VERSION");
      const outcome =
        request.kind === "AUTOMATION"
          ? adapter.automate!(restored, request.intent, at)
          : adapter.execute(restored, request.command, actor!, at);
      if (!outcome.events.length) {
        if (request.kind !== "AUTOMATION") throw conflict();
        return {
          schemaVersion: 1,
          matchId: row.id,
          actionId: request.actionId,
          stateVersion: row.stateVersion,
          lastEventSeq: row.lastEventSeq,
          status,
        };
      }
      state = json(adapter.restore(outcome.state, ids));
      for (const event of outcome.events) {
        if (event.schemaVersion !== adapter.descriptor.eventSchemaVersion)
          throw new MatchFault("INCOMPATIBLE_GAME_VERSION");
        events.push({
          type: "GAME_ENGINE_EVENT",
          schemaVersion: event.schemaVersion,
          payload: { type: event.type, event: event.payload },
        });
      }
      if (outcome.result !== null) {
        const parsed = standardResultInputSchema.safeParse(outcome.result);
        if (
          !parsed.success ||
          parsed.data.placements.length !== ids.length ||
          parsed.data.placements.some((p) => !ids.includes(p.playerId))
        )
          throw new MatchFault("INTERNAL_ERROR");
        resultInput = parsed.data;
        transition("FINISHED");
        finishedAt = new Date(at);
      }
    }
    if (!events.length || row.lastEventSeq > 2147483647 - events.length) throw conflict();
    const version = row.stateVersion + 1;
    let seq = row.lastEventSeq;
    for (const event of events)
      await db.gameEvent.create({
        data: {
          id: randomUUID(),
          matchId: row.id,
          seq: ++seq,
          schemaVersion: event.schemaVersion,
          type: event.type,
          actorUserId: actor,
          payloadJsonb: json(event.payload),
          createdAt: new Date(at),
        },
      });
    // Preserve SQL NULL before initialization; Prisma JSON-null sentinels remain private.
    if (state === null)
      await db.match.update({
        where: { id: row.id },
        data: {
          status,
          stateVersion: version,
          lastEventSeq: seq,
          startedAt,
          finishedAt,
        },
      });
    else
      await db.match.update({
        where: { id: row.id },
        data: {
          status,
          stateJsonb: state,
          stateVersion: version,
          lastEventSeq: seq,
          startedAt,
          finishedAt,
        },
      });
    const ack: MatchAck = {
      schemaVersion: 1,
      matchId: row.id,
      actionId: request.actionId,
      stateVersion: version,
      lastEventSeq: seq,
      status,
    };
    await db.processedCommand.create({
      data: {
        matchId: row.id,
        actionId: request.actionId,
        actorUserId: actor,
        schemaVersion: 1,
        expectedVersion: request.expectedVersion,
        resultingVersion: version,
        requestDigest: digest,
        resultJsonb: ack,
        createdAt: new Date(at),
      },
    });
    await db.outboxEvent.create({
      data: {
        id: randomUUID(),
        aggregateId: row.id,
        type: "MATCH_CHANGED_V1",
        schemaVersion: 1,
        payloadJsonb: {
          schemaVersion: 1,
          matchId: row.id,
          stateVersion: version,
          lastEventSeq: seq,
          status,
        },
        status: "PENDING",
        requestId: correlation.requestId ?? null,
        traceparent: correlation.traceparent ?? null,
        nextAttemptAt: new Date(at),
        createdAt: new Date(at),
      },
    });
    if (resultInput !== null) {
      const payload = matchFinishedInputSchema.parse({
        schemaVersion: 1,
        matchId: row.id,
        gameId: row.gameId,
        stateVersion: version,
        lastEventSeq: seq,
        finishedAt: at,
        engineVersion: row.engineVersion,
        stateSchemaVersion: row.stateSchemaVersion,
        rulesetVersion: row.rulesetVersion,
        result: resultInput,
      });
      const resultEventId = randomUUID();
      await persistMatchResult(db, resultEventId, payload);
      await db.outboxEvent.create({
        data: {
          id: resultEventId,
          aggregateId: row.id,
          type: "MATCH_FINISHED_V1",
          schemaVersion: 1,
          payloadJsonb: payload,
          status: "PENDING",
          nextAttemptAt: new Date(at),
          createdAt: new Date(at),
          requestId: correlation.requestId ?? null,
          traceparent: correlation.traceparent ?? null,
        },
      });
    }
    return ack;
  }
  return {
    async process(actor, request, correlation = {}) {
      if (request.kind === "AUTOMATION") {
        const checkpoint = await scope.execute((db) =>
          db.match.findUnique({
            where: { id: request.matchId },
            select: { id: true, status: true, stateVersion: true, lastEventSeq: true },
          }),
        );
        if (!checkpoint) throw new MatchFault("NOT_FOUND");
        if (actor !== null) throw new MatchFault("FORBIDDEN");
        // Durable versions never decrease and terminal Matches never reactivate.
        // An already obsolete worker job cannot mutate this Match. Do not make
        // it wait for a writer lock or load discarded state/roster data. A job
        // that might still apply goes through all existing locked guards below.
        if (
          checkpoint.status !== "ACTIVE" ||
          checkpoint.stateVersion !== request.intent.expectedStateVersion
        )
          return {
            schemaVersion: 1,
            matchId: checkpoint.id,
            actionId: request.actionId,
            stateVersion: checkpoint.stateVersion,
            lastEventSeq: checkpoint.lastEventSeq,
            status: checkpoint.status as MatchStatus,
          };
      }
      for (let attempt = 0; ; attempt++) {
        let fault: MatchFault | undefined;
        try {
          return await scope.transaction(async (db) => {
            try {
              return await apply(db, actor, request, correlation);
            } catch (error) {
              if (error instanceof MatchFault) fault = error;
              throw error;
            }
          });
        } catch (error) {
          if (fault) throw fault;
          if (
            !(error instanceof DatabaseError) ||
            error.code !== "DATABASE_TRANSACTION_CONFLICT" ||
            attempt >= 2
          )
            throw error;
        }
      }
    },
  };
}

import {
  personalStartSchema as startSchema,
  personalReadSchema as readSchema,
  personalCloseSchema as closeSchema,
} from "../../application/personal.js";
import { hash, randomUUID } from "node:crypto";
import type { createDatabase } from "@hambazi/database";
import { z } from "zod";
import { createErrorEnvelope } from "@hambazi/contracts";
import { MatchFault, matchCommandSchema, type MatchGame } from "../../application/processing.js";
import type { MatchViewGame } from "../../application/resync.js";
import { createMatchProcessingRepository } from "./processing.js";
import { createMatchResyncRepository } from "./resync.js";
import { personalMatchType } from "./personal-roster.js";
function identity(owner: string, command: string) {
  const h = hash("sha256", `personal-bots-v1/${owner}/${command}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function createPersonalMatchRepository(
  database: ReturnType<typeof createDatabase>,
  options: {
    game: MatchGame & MatchViewGame;
    clock: { nowMs(): number };
    owner: { allowsUserId(id: string): Promise<boolean> };
  },
) {
  const scope = database.forModule("matches"),
    game = options.game;
  const writer = createMatchProcessingRepository(database, {
    clock: options.clock,
    games: [game],
    personal: true,
  });
  const views = createMatchResyncRepository(database, [game], true);
  async function authorize(actor: string) {
    if (!z.uuid().safeParse(actor).success || !(await options.owner.allowsUserId(actor)))
      throw new MatchFault("FORBIDDEN");
  }
  async function safe(operation: () => Promise<unknown>) {
    try {
      return { ok: true as const, value: await operation() };
    } catch (error) {
      return createErrorEnvelope(error instanceof MatchFault ? error.code : "INTERNAL_ERROR");
    }
  }
  return Object.freeze({
    current: (actor: string) =>
      safe(async () => {
        await authorize(actor);
        const rows = await scope.execute((db) =>
          db.match.findMany({
            where: {
              matchType: personalMatchType,
              status: "ACTIVE",
            },
            take: 1,
            select: { id: true },
          }),
        );
        const found = rows[0]?.id;
        const own = found
          ? await scope.execute((db) =>
              db.matchPlayer.findUnique({
                where: { matchId_userId: { matchId: found, userId: actor } },
              }),
            )
          : null;
        return { schemaVersion: 1, matchId: own ? found : null };
      }),
    start: (actor: string, input: unknown) =>
      safe(async () => {
        await authorize(actor);
        const p = startSchema.safeParse(input);
        if (!p.success) throw new MatchFault("INVALID_INPUT");
        const matchId = identity(actor, p.data.commandId);
        let fault: MatchFault | undefined;
        try {
          await scope.transaction(async (db) => {
            try {
              await db.lockPersonalAdmission();
              const previous = await db.match.findUnique({ where: { id: matchId } });
              if (previous) {
                if (
                  previous.matchType !== personalMatchType ||
                  !(await db.matchPlayer.findUnique({
                    where: { matchId_userId: { matchId, userId: actor } },
                  }))
                )
                  throw new MatchFault("FORBIDDEN");
                return;
              }
              const active = await db.match.findFirst({
                where: {
                  matchType: personalMatchType,
                  status: "ACTIVE",
                },
                select: { id: true },
              });
              if (active) throw new MatchFault("GAME_STATE_CONFLICT");
              const at = options.clock.nowMs(),
                bot = randomUUID(),
                state = z
                  .record(z.string(), z.json())
                  .parse(game.restore(game.initialize([actor, bot], at), [actor, bot]));
              await db.match.create({
                data: {
                  id: matchId,
                  gameId: game.gameId,
                  matchType: personalMatchType,
                  status: "ACTIVE",
                  engineVersion: game.descriptor.engineVersion,
                  stateSchemaVersion: game.descriptor.stateSchemaVersion,
                  rulesetVersion: game.descriptor.rulesetVersion,
                  stateJsonb: state,
                  stateVersion: 1,
                  lastEventSeq: 4,
                  startedAt: new Date(at),
                  createdAt: new Date(at),
                },
              });
              await db.matchPlayer.create({
                data: {
                  matchId,
                  userId: actor,
                  seat: 0,
                  agentType: "HUMAN",
                  connectionStatus: "CONNECTED",
                  readyAt: new Date(at),
                },
              });
              await db.matchBotSeat.create({ data: { matchId, actorId: bot, seat: 1 } });
              for (const [i, status] of [
                "WAITING_FOR_PLAYERS",
                "READY",
                "STARTING",
                "ACTIVE",
              ].entries())
                await db.gameEvent.create({
                  data: {
                    id: randomUUID(),
                    matchId,
                    seq: i + 1,
                    schemaVersion: 1,
                    type: i === 3 ? "MATCH_INITIALIZED_V1" : "MATCH_LIFECYCLE_V1",
                    actorUserId: actor,
                    payloadJsonb: i === 3 ? { snapshot: state } : { to: status, occurredAt: at },
                  },
                });
              await db.processedCommand.create({
                data: {
                  matchId,
                  actionId: p.data.commandId,
                  actorUserId: actor,
                  schemaVersion: 1,
                  expectedVersion: 0,
                  resultingVersion: 1,
                  requestDigest: hash("sha256", JSON.stringify(p.data)),
                  resultJsonb: {
                    schemaVersion: 1,
                    matchId,
                    actionId: p.data.commandId,
                    stateVersion: 1,
                    lastEventSeq: 4,
                    status: "ACTIVE",
                  },
                },
              });
              await db.outboxEvent.create({
                data: {
                  id: randomUUID(),
                  aggregateId: matchId,
                  type: "PERSONAL_MATCH_CHANGED_V1",
                  schemaVersion: 1,
                  payloadJsonb: {
                    schemaVersion: 1,
                    matchId,
                    stateVersion: 1,
                    lastEventSeq: 4,
                    status: "ACTIVE",
                  },
                  status: "PENDING",
                },
              });
            } catch (e) {
              if (e instanceof MatchFault) fault = e;
              throw e;
            }
          });
        } catch (e) {
          throw fault ?? e;
        }
        return (await views.read(actor, matchId)).snapshot;
      }),
    read: (actor: string, input: unknown) =>
      safe(async () => {
        await authorize(actor);
        const p = readSchema.safeParse(input);
        if (!p.success) throw new MatchFault("INVALID_INPUT");
        return (await views.read(actor, p.data.matchId)).snapshot;
      }),
    command: (actor: string, input: unknown) =>
      safe(async () => {
        await authorize(actor);
        const p = matchCommandSchema.safeParse(input);
        if (!p.success) throw new MatchFault("INVALID_INPUT");
        return writer.process(actor, { ...p.data, kind: "GAME" });
      }),
    close: (actor: string, input: unknown) =>
      safe(async () => {
        await authorize(actor);
        const p = closeSchema.safeParse(input);
        if (!p.success) throw new MatchFault("INVALID_INPUT");
        await views.read(actor, p.data.matchId);
        return writer.process(null, { ...p.data, kind: "LIFECYCLE", operation: "TERMINATE" });
      }),
  });
}

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { createDatabase } from "@hambazi/database";
import { automationIntentSchema, recoveryPageSchema } from "../../application/automation.js";
import { matchCorrelationSchema } from "../../application/correlation.js";
import { MatchFault } from "../../application/processing.js";
import { createMatchProcessingRepository } from "./processing.js";

/** Trusted Worker boundary. No snapshot, command, credential or private view leaves this port. */
export function createMatchAutomationRepository(
  database: ReturnType<typeof createDatabase>,
  options: Parameters<typeof createMatchProcessingRepository>[1],
) {
  const scope = database.forModule("matches");
  const writer = createMatchProcessingRepository(database, options);
  const games = [...options.games];
  async function safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new MatchFault(error instanceof MatchFault ? error.code : "INTERNAL_ERROR");
    }
  }
  return Object.freeze({
    recover: (input: unknown) =>
      safe(async () => {
        const parsed = recoveryPageSchema.safeParse(input);
        if (!parsed.success) throw new MatchFault("INVALID_INPUT");
        const { after, limit } = parsed.data;
        const rows = await scope.execute((db) =>
          after === null
            ? db.match.findMany({
                where: { status: "ACTIVE" },
                orderBy: { id: "asc" },
                take: limit,
                select: { id: true },
              })
            : db.match.findMany({
                where: { status: "ACTIVE", id: { gt: after } },
                orderBy: { id: "asc" },
                take: limit,
                select: { id: true },
              }),
        );
        return {
          matchIds: rows.map((row) => row.id),
          next: rows.length === limit ? rows.at(-1)!.id : null,
        };
      }),
    plan: (input: unknown) =>
      safe(async () => {
        const parsed = z.uuid().safeParse(input);
        if (!parsed.success) throw new MatchFault("INVALID_INPUT");
        let fault: MatchFault | undefined;
        try {
          return await scope.transaction(async (db) => {
            try {
              await db.lockMatch(parsed.data);
              const row = await db.match.findUnique({ where: { id: parsed.data } });
              if (!row || row.status !== "ACTIVE") return null;
              const players = await db.matchPlayer.findMany({
                where: { matchId: row.id },
                orderBy: { seat: "asc" },
              });
              const game = games.find(
                (g) =>
                  g.gameId === row.gameId &&
                  g.descriptor.engineVersion === row.engineVersion &&
                  g.descriptor.stateSchemaVersion === row.stateSchemaVersion &&
                  g.descriptor.rulesetVersion === row.rulesetVersion,
              );
              if (!game?.automation || !game.automate)
                throw new MatchFault("INCOMPATIBLE_GAME_VERSION");
              const state = game.restore(
                row.stateJsonb,
                players.map((p) => p.userId),
              );
              const at = options.clock.nowMs();
              if (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000)
                throw new MatchFault("INTERNAL_ERROR");
              const intent = game.automation(
                state,
                players.filter((p) => p.agentType === "BOT").map((p) => p.userId),
                at,
              );
              const seat = players.find((p) => p.userId === intent?.playerId);
              return {
                playerIds: players.filter((p) => p.agentType === "HUMAN").map((p) => p.userId),
                intent:
                  intent === null
                    ? null
                    : automationIntentSchema.parse({
                        schemaVersion: 1,
                        matchId: row.id,
                        expectedStateVersion: row.stateVersion,
                        ...intent,
                        expectedConnectionEpoch: seat?.connectionEpoch ?? null,
                      }),
              };
            } catch (error) {
              if (error instanceof MatchFault) fault = error;
              throw error;
            }
          });
        } catch (error) {
          throw fault ?? error;
        }
      }),
    execute: (input: unknown, context: unknown = {}) =>
      safe(async () => {
        const intent = automationIntentSchema.safeParse(input);
        const correlation = matchCorrelationSchema.safeParse(context);
        if (!intent.success || !correlation.success) throw new MatchFault("INVALID_INPUT");
        return writer.process(
          null,
          {
            schemaVersion: 1,
            matchId: intent.data.matchId,
            actionId: randomUUID(),
            expectedVersion: intent.data.expectedStateVersion,
            kind: "AUTOMATION",
            intent: intent.data,
          },
          correlation.data,
        );
      }),
  });
}

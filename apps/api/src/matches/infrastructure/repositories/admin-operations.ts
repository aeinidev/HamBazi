import { randomUUID } from "node:crypto";
import type { createDatabase } from "@hambazi/database";
import type { AdminEffectCommand } from "@hambazi/contracts";
import { adminActionSchema } from "@hambazi/validation";
import { canTransition, type MatchStatus } from "../../domain/lifecycle.js";
import { personalMatchType } from "./personal-roster.js";

export function createMatchesAdminOperationsRepository(
  database: ReturnType<typeof createDatabase>,
  clock: { nowMs(): number },
) {
  const scope = database.forModule("matches");
  function action(input: AdminEffectCommand["action"]) {
    const a = adminActionSchema.parse(input);
    if (a.operation !== "MATCH_TERMINATE") throw new Error("ADMIN_EFFECT_INVALID");
    return a;
  }
  function check(
    row: { actorId: string; realmId: string; digest: string; targetId: string; resultCode: string },
    op: AdminEffectCommand,
  ) {
    if (
      row.actorId !== op.actorId ||
      row.realmId !== op.realmId ||
      row.digest !== op.digest ||
      row.targetId !== op.action.targetId
    )
      throw new Error("ADMIN_EFFECT_CONFLICT");
    return { code: row.resultCode };
  }
  return {
    async target(input: AdminEffectCommand["action"]) {
      const a = action(input),
        row = await scope.execute((db) =>
          db.match.findUnique({
            where: { id: a.targetId },
            select: { gameId: true, stateVersion: true },
          }),
        );
      return row ? { gameId: row.gameId, version: row.stateVersion } : null;
    },
    async outcome(op: AdminEffectCommand) {
      const row = await scope.execute((db) =>
        db.matchAdminEffect.findUnique({ where: { id: op.id } }),
      );
      return row ? check(row, op) : null;
    },
    execute(op: AdminEffectCommand) {
      const a = action(op.action);
      return scope.transaction(async (db) => {
        await db.lockMatch(a.targetId);
        await db.lockAdminEffect(op.id);
        const previous = await db.matchAdminEffect.findUnique({ where: { id: op.id } });
        if (previous) return check(previous, op);
        // Same single-writer lock as gameplay; termination never loads or rewrites private engine state.
        const row = await db.match.findUnique({
          where: { id: a.targetId },
          select: {
            gameId: true,
            stateVersion: true,
            lastEventSeq: true,
            status: true,
            matchType: true,
          },
        });
        const time = new Date(clock.nowMs());
        const allowed =
          row &&
          row.gameId === op.gameId &&
          row.stateVersion === a.expectedVersion &&
          row.stateVersion < 2147483647 &&
          row.lastEventSeq < 2147483647 &&
          canTransition(row.status as MatchStatus, "TERMINATED");
        const code = allowed ? "APPLIED" : "VERSION_OR_STATE_CONFLICT";
        if (allowed) {
          const version = row.stateVersion + 1,
            seq = row.lastEventSeq + 1;
          await db.match.update({
            where: { id: a.targetId },
            data: {
              status: "TERMINATED",
              stateVersion: version,
              lastEventSeq: seq,
              finishedAt: time,
            },
            select: { id: true },
          });
          await db.gameEvent.create({
            data: {
              id: randomUUID(),
              matchId: a.targetId,
              seq,
              schemaVersion: 1,
              type: "MATCH_LIFECYCLE_V1",
              actorUserId: null,
              payloadJsonb: { from: row.status, to: "TERMINATED", occurredAt: time.getTime() },
              createdAt: time,
            },
            select: { id: true },
          });
          const ack = {
            schemaVersion: 1,
            matchId: a.targetId,
            actionId: op.id,
            stateVersion: version,
            lastEventSeq: seq,
            status: "TERMINATED",
          };
          await db.processedCommand.create({
            data: {
              matchId: a.targetId,
              actionId: op.id,
              actorUserId: null,
              schemaVersion: 1,
              expectedVersion: a.expectedVersion,
              resultingVersion: version,
              requestDigest: op.digest,
              resultJsonb: ack,
              createdAt: time,
            },
            select: { matchId: true },
          });
          await db.outboxEvent.create({
            data: {
              id: randomUUID(),
              aggregateId: a.targetId,
              type:
                row.matchType === personalMatchType
                  ? "PERSONAL_MATCH_CHANGED_V1"
                  : "MATCH_CHANGED_V1",
              schemaVersion: 1,
              payloadJsonb: {
                schemaVersion: 1,
                matchId: a.targetId,
                stateVersion: version,
                lastEventSeq: seq,
                status: "TERMINATED",
              },
              status: "PENDING",
              nextAttemptAt: time,
              createdAt: time,
            },
            select: { id: true },
          });
        }
        await db.matchAdminEffect.create({
          data: {
            id: op.id,
            realmId: op.realmId,
            actorId: op.actorId,
            digest: op.digest,
            targetId: a.targetId,
            resultCode: code,
            occurredAt: time,
          },
        });
        return { code };
      });
    },
  };
}

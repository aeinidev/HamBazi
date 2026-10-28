import type { createDatabase } from "@hambazi/database";
import type { AdminEffectCommand } from "@hambazi/contracts";
import { adminActionSchema } from "@hambazi/validation";
import { normalizeDisplayName } from "../../domain/account-name.js";

export function createUsersAdminOperationsRepository(
  database: ReturnType<typeof createDatabase>,
  clock: { nowMs(): number },
) {
  const scope = database.forModule("users");
  const action = (input: AdminEffectCommand["action"]) => {
    const a = adminActionSchema.parse(input);
    if (
      a.operation !== "USER_DISPLAY_NAME" &&
      a.operation !== "USER_RESTRICT" &&
      a.operation !== "USER_UNRESTRICT"
    )
      throw new Error("ADMIN_EFFECT_INVALID");
    return a;
  };
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
      const a = action(input);
      const row = await scope.execute((db) =>
        db.user.findUnique({ where: { id: a.targetId }, select: { profileVersion: true } }),
      );
      return row ? { gameId: null, version: row.profileVersion } : null;
    },
    async outcome(op: AdminEffectCommand) {
      const row = await scope.execute((db) =>
        db.userAdminEffect.findUnique({ where: { id: op.id } }),
      );
      return row ? check(row, op) : null;
    },
    async execute(op: AdminEffectCommand) {
      const a = action(op.action);
      return scope.transaction(async (db) => {
        await db.lockAdminEffect(a.targetId);
        const previous = await db.userAdminEffect.findUnique({ where: { id: op.id } });
        if (previous) return check(previous, op);
        if (op.gameId !== null) throw new Error("ADMIN_EFFECT_INVALID");
        if (a.operation === "USER_RESTRICT" || a.operation === "USER_UNRESTRICT") {
          const now = new Date(clock.nowMs());
          const active = await db.userRestriction.findFirst({
            where: { userId: a.targetId, endedAt: null },
          });
          const restricting = a.operation === "USER_RESTRICT";
          if (
            !op.reasonCode ||
            !["ABUSE", "SPAM", "SECURITY", "INCIDENT_RESPONSE", "APPEAL"].includes(op.reasonCode)
          )
            throw new Error("ADMIN_EFFECT_INVALID");
          const valid = restricting
            ? !active
            : active
              ? active.id === a.restrictionId
              : a.restrictionId === null;
          const changed = valid
            ? await db.user.updateMany({
                where: {
                  id: a.targetId,
                  profileVersion: a.expectedVersion,
                  status: restricting ? "ACTIVE" : "BANNED",
                },
                data: {
                  status: restricting ? "BANNED" : "ACTIVE",
                  profileVersion: { increment: 1 },
                  authVersion: { increment: 1 },
                },
              })
            : { count: 0 };
          if (changed.count === 1) {
            if (restricting) {
              const durations = {
                HOUR_1: 3600000,
                HOURS_24: 86400000,
                DAYS_7: 604800000,
                DAYS_30: 2592000000,
                PERMANENT: null,
              };
              const duration = durations[a.duration];
              await db.userRestriction.create({
                data: {
                  id: op.id,
                  userId: a.targetId,
                  realmId: op.realmId,
                  actorId: op.actorId,
                  duration: a.duration,
                  reasonCode: op.reasonCode,
                  createdAt: now,
                  expiresAt: duration === null ? null : new Date(now.getTime() + duration),
                },
              });
            } else if (active) {
              await db.userRestriction.update({
                where: { id: active.id },
                data: { endedAt: now, endKind: "REVOKED", endedByOperationId: op.id },
              });
            }
          }
          const code = changed.count === 1 ? "APPLIED" : "VERSION_OR_STATE_CONFLICT";
          await db.userAdminEffect.create({
            data: {
              id: op.id,
              actorId: op.actorId,
              realmId: op.realmId,
              digest: op.digest,
              targetId: a.targetId,
              resultCode: code,
              occurredAt: now,
            },
          });
          return { code };
        }
        const name = normalizeDisplayName(a.displayName);
        const changed =
          name === undefined
            ? { count: 0 }
            : await db.user.updateMany({
                where: {
                  id: a.targetId,
                  profileVersion: a.expectedVersion,
                  status: { in: ["ACTIVE", "BANNED"] },
                },
                data: { profileVersion: { increment: 1 }, displayName: name },
              });
        const code =
          name === undefined
            ? "INVALID_DISPLAY_NAME"
            : changed.count === 1
              ? "APPLIED"
              : "VERSION_OR_STATE_CONFLICT";
        await db.userAdminEffect.create({
          data: {
            id: op.id,
            realmId: op.realmId,
            actorId: op.actorId,
            digest: op.digest,
            targetId: a.targetId,
            resultCode: code,
            occurredAt: new Date(clock.nowMs()),
          },
        });
        return { code };
      });
    },
  };
}

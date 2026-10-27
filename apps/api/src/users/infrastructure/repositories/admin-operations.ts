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
    if (a.operation !== "USER_DISPLAY_NAME" && a.operation !== "USER_STATUS")
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
    execute(op: AdminEffectCommand) {
      const a = action(op.action);
      return scope.transaction(async (db) => {
        await db.lockAdminEffect(op.id);
        const previous = await db.userAdminEffect.findUnique({ where: { id: op.id } });
        if (previous) return check(previous, op);
        if (op.gameId !== null) throw new Error("ADMIN_EFFECT_INVALID");
        const name =
          a.operation === "USER_DISPLAY_NAME" ? normalizeDisplayName(a.displayName) : null;
        const changed =
          name === undefined
            ? { count: 0 }
            : a.operation === "USER_STATUS"
              ? await db.user.updateMany({
                  where: {
                    id: a.targetId,
                    profileVersion: a.expectedVersion,
                    status: { in: ["ACTIVE", "BANNED"] },
                  },
                  data: {
                    profileVersion: { increment: 1 },
                    status: a.status,
                    authVersion: { increment: 1 },
                  },
                })
              : await db.user.updateMany({
                  where: {
                    id: a.targetId,
                    profileVersion: a.expectedVersion,
                    status: { in: ["ACTIVE", "BANNED"] },
                  },
                  data: { profileVersion: { increment: 1 }, displayName: name! },
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

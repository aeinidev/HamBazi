import type { createDatabase } from "@hambazi/database";
import type { AdminEffectCommand } from "@hambazi/contracts";
import { adminActionSchema } from "@hambazi/validation";

export function createRoomsAdminOperationsRepository(
  database: ReturnType<typeof createDatabase>,
  clock: { nowMs(): number },
) {
  const scope = database.forModule("rooms");
  function action(input: AdminEffectCommand["action"]) {
    const a = adminActionSchema.parse(input);
    if (a.operation !== "ROOM_CLOSE") throw new Error("ADMIN_EFFECT_INVALID");
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
          db.room.findUnique({
            where: { id: a.targetId },
            select: { gameId: true, stateVersion: true },
          }),
        );
      return row ? { gameId: row.gameId, version: row.stateVersion } : null;
    },
    async outcome(op: AdminEffectCommand) {
      const row = await scope.execute((db) =>
        db.roomAdminEffect.findUnique({ where: { id: op.id } }),
      );
      return row ? check(row, op) : null;
    },
    execute(op: AdminEffectCommand) {
      const a = action(op.action);
      return scope.transaction(async (db) => {
        await db.lockRooms();
        await db.lockAdminEffect(op.id);
        const previous = await db.roomAdminEffect.findUnique({ where: { id: op.id } });
        if (previous) return check(previous, op);
        const changed = await db.room.updateMany({
          where: {
            id: a.targetId,
            gameId: op.gameId ?? "",
            stateVersion: a.expectedVersion,
            status: { in: ["WAITING", "FULL"] },
            startedMatchId: null,
          },
          data: { status: "CLOSED", stateVersion: { increment: 1 } },
        });
        const code = changed.count === 1 ? "APPLIED" : "VERSION_OR_STATE_CONFLICT";
        await db.roomAdminEffect.create({
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

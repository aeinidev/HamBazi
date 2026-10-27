import type { createDatabase } from "@hambazi/database";
import type { AdminEffectCommand } from "@hambazi/contracts";
import { adminActionSchema } from "@hambazi/validation";

export function createGamesAdminOperationsRepository(
  database: ReturnType<typeof createDatabase>,
  clock: { nowMs(): number },
) {
  const scope = database.forModule("games");
  function action(input: AdminEffectCommand["action"]) {
    const a = adminActionSchema.parse(input);
    if (a.operation !== "GAME_AVAILABILITY") throw new Error("ADMIN_EFFECT_INVALID");
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
    async allowsNewMatches(gameId: string) {
      const row = await scope.execute((db) =>
        db.game.findUnique({ where: { id: gameId }, select: { adminAvailability: true } }),
      );
      return row?.adminAvailability === "ACTIVE";
    },
    async target(input: AdminEffectCommand["action"]) {
      const a = action(input),
        row = await scope.execute((db) =>
          db.game.findUnique({ where: { id: a.targetId }, select: { adminVersion: true } }),
        );
      return row ? { gameId: a.targetId, version: row.adminVersion } : null;
    },
    async outcome(op: AdminEffectCommand) {
      const row = await scope.execute((db) =>
        db.gameAdminEffect.findUnique({ where: { id: op.id } }),
      );
      return row ? check(row, op) : null;
    },
    execute(op: AdminEffectCommand) {
      const a = action(op.action);
      return scope.transaction(async (db) => {
        await db.lockAdminEffect(op.id);
        const previous = await db.gameAdminEffect.findUnique({ where: { id: op.id } });
        if (previous) return check(previous, op);
        if (op.gameId !== a.targetId) throw new Error("ADMIN_EFFECT_INVALID");
        // This gate can only restrict released capabilities; it never changes the release registration or engine pins.
        const changed = await db.game.updateMany({
          where: { id: a.targetId, adminVersion: a.expectedVersion },
          data: { adminAvailability: a.status, adminVersion: { increment: 1 } },
        });
        const code = changed.count === 1 ? "APPLIED" : "VERSION_OR_STATE_CONFLICT";
        await db.gameAdminEffect.create({
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

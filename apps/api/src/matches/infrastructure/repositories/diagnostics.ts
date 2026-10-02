import type { createDatabase } from "@hambazi/database";
/** Infrastructure aggregate port only: never reads state, commands, event payloads or identities. */
export function createMatchDiagnosticsRepository(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("matches");
  return async () =>
    scope.transaction(async (db) => {
      const [states, players, started, connections] = await Promise.all([
        Promise.all(
          [
            "CREATED",
            "WAITING_FOR_PLAYERS",
            "READY",
            "STARTING",
            "ACTIVE",
            "FINISHED",
            "TERMINATED",
          ].map((status) => db.match.count({ where: { status } })),
        ),
        Promise.all(
          ["DISCONNECTED", "REPLACED_BY_BOT"].map((connectionStatus) =>
            db.matchPlayer.count({ where: { connectionStatus } }),
          ),
        ),
        db.match.count({ where: { startedAt: { not: null } } }),
        Promise.all(
          ["PLAYER_DISCONNECTED_V1", "PLAYER_RECONNECTED_V1", "PLAYER_BOT_TAKEOVER_V1"].map(
            (type) => db.gameEvent.count({ where: { type } }),
          ),
        ),
      ]);
      return Object.freeze({
        matches_created: states[0]!,
        matches_waiting: states[1]!,
        matches_ready: states[2]!,
        matches_starting: states[3]!,
        matches_active: states[4]!,
        matches_started: started,
        matches_finished: states[5]!,
        matches_terminated: states[6]!,
        players_disconnected: players[0]!,
        players_bot: players[1]!,
        disconnects_recorded: connections[0]!,
        reconnects_recorded: connections[1]!,
        bot_takeovers_recorded: connections[2]!,
      });
    });
}
export function createOutboxDiagnosticsRepository(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("outbox");
  return async () =>
    scope.transaction(async (db) => {
      const [pending, failed, oldest] = await Promise.all([
        db.outboxEvent.count({ where: { status: "PENDING" } }),
        db.outboxEvent.count({ where: { status: "FAILED" } }),
        db.outboxEvent.findFirst({
          where: { status: "PENDING" },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
      ]);
      return Object.freeze({
        outbox_pending: pending,
        outbox_failed: failed,
        outbox_oldest_pending_seconds: oldest
          ? Math.max(0, (Date.now() - oldest.createdAt.getTime()) / 1000)
          : 0,
      });
    });
}

/** Admission metadata is API-only; Worker diagnostics must not widen its existing grants. */
export function createAdmissionDiagnosticsRepository(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("matches");
  return async () =>
    scope.transaction(async (db) => {
      const at = new Date();
      const [searching, reserved, oldest] = await Promise.all([
        db.matchAdmission.count({ where: { status: "SEARCHING", expiresAt: { gt: at } } }),
        db.matchAdmission.count({ where: { status: "RESERVED", expiresAt: { gt: at } } }),
        db.matchAdmission.findFirst({
          where: { status: "SEARCHING", expiresAt: { gt: at } },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
      ]);
      return Object.freeze({
        admissions_searching: searching,
        admissions_reserved: reserved,
        admissions_oldest_wait_seconds: oldest
          ? Math.max(0, (at.getTime() - oldest.createdAt.getTime()) / 1000)
          : 0,
      });
    });
}

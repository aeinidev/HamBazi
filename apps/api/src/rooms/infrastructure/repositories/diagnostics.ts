import type { createDatabase } from "@hambazi/database";
export function createRoomDiagnosticsRepository(database: ReturnType<typeof createDatabase>) {
  const scope = database.forModule("rooms");
  return async () =>
    scope.transaction(async (db) => {
      const states = await Promise.all(
        ["WAITING", "FULL", "STARTING", "STARTED", "CLOSED", "EXPIRED"].map((status) =>
          db.room.count({ where: { status } }),
        ),
      );
      return Object.freeze({
        rooms_waiting: states[0]!,
        rooms_full: states[1]!,
        rooms_starting: states[2]!,
        rooms_started: states[3]!,
        rooms_closed: states[4]!,
        rooms_expired: states[5]!,
      });
    });
}

import { roomsService } from "./application/rooms.js";
import { createRoomsRepository } from "./infrastructure/repositories/rooms.js";
export function createRoomsPort(
  database: Parameters<typeof createRoomsRepository>[0],
  options: Parameters<typeof createRoomsRepository>[1],
  ports: Omit<Parameters<typeof roomsService>[0], "repository">,
) {
  return roomsService({ ...ports, repository: createRoomsRepository(database, options) });
}

import { createRoomDiagnosticsRepository } from "./infrastructure/repositories/diagnostics.js";
export function createRoomDiagnostics(
  database: Parameters<typeof createRoomDiagnosticsRepository>[0],
) {
  return createRoomDiagnosticsRepository(database);
}

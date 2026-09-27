export type RoomStatus = "WAITING" | "FULL" | "STARTING" | "STARTED" | "CLOSED" | "EXPIRED";
export interface Member {
  userId: string;
  seat: number;
  joinedAt: number;
  joinedVersion: number;
}
export interface Room {
  id: string;
  gameId: string;
  hostUserId: string;
  capacity: number;
  version: number;
  status: RoomStatus;
  expiresAt: number;
  startedMatchId: string | null;
  members: Member[];
}
export type RoomCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "ROOM_CONFLICT"
  | "GAME_UNAVAILABLE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";
export class RoomFault extends Error {
  constructor(readonly code: RoomCode) {
    super(code);
  }
}
function nextVersion(room: Room) {
  if (!Number.isInteger(room.version) || room.version < 0 || room.version >= 2147483647)
    throw new RoomFault("ROOM_CONFLICT");
  return room.version + 1;
}
export function expire(room: Room, at: number): Room {
  return ["WAITING", "FULL"].includes(room.status) && at >= room.expiresAt
    ? { ...room, status: "EXPIRED", version: nextVersion(room) }
    : room;
}
export function transition(
  room: Room,
  actor: string,
  kind: "join" | "leave" | "start",
  expectedVersion: number,
  at: number,
): Room {
  const member = room.members.find((m) => m.userId === actor);
  if (kind !== "join" && !member) throw new RoomFault("NOT_FOUND");
  if (kind === "start" && room.hostUserId !== actor) throw new RoomFault("FORBIDDEN");
  if (!["WAITING", "FULL"].includes(room.status) || at >= room.expiresAt)
    throw new RoomFault("ROOM_CONFLICT");
  // A new join intent from an existing member has no effect. Old committed
  // command retries are handled by the receipt before reaching this function.
  if (kind === "join" && member) return room;
  if (expectedVersion !== room.version) throw new RoomFault("ROOM_CONFLICT");
  const version = nextVersion(room);
  if (kind === "start") {
    if (room.status !== "FULL" || room.members.length !== room.capacity)
      throw new RoomFault("ROOM_CONFLICT");
    return { ...room, version, status: "STARTING" };
  }
  if (kind === "join") {
    if (room.members.length >= room.capacity) throw new RoomFault("ROOM_CONFLICT");
    let seat = 0;
    while (room.members.some((m) => m.seat === seat)) seat++;
    const members = [
      ...room.members,
      { userId: actor, seat, joinedAt: at, joinedVersion: version },
    ];
    return {
      ...room,
      version,
      members,
      status: members.length === room.capacity ? "FULL" : "WAITING",
    };
  }
  const members = room.members.filter((m) => m.userId !== actor);
  const oldest = [...members].sort(
    (a, b) =>
      a.joinedVersion - b.joinedVersion ||
      a.joinedAt - b.joinedAt ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  )[0];
  return {
    ...room,
    version,
    members,
    status: members.length ? "WAITING" : "CLOSED",
    hostUserId: room.hostUserId === actor ? (oldest?.userId ?? room.hostUserId) : room.hostUserId,
  };
}
/** Trusted Match workflow only, after durable Match commit. No client transport. */
export function confirmStarted(room: Room, version: number, matchId: string): Room {
  if (room.status === "STARTED" && room.startedMatchId === matchId && room.version === version + 1)
    return room;
  if (room.status !== "STARTING" || room.version !== version) throw new RoomFault("ROOM_CONFLICT");
  return { ...room, version: nextVersion(room), status: "STARTED", startedMatchId: matchId };
}
export function closeStarted(room: Room, matchId: string): Room {
  if (room.startedMatchId !== matchId || !["STARTED", "CLOSED"].includes(room.status))
    throw new RoomFault("ROOM_CONFLICT");
  return room.status === "CLOSED"
    ? room
    : { ...room, version: nextVersion(room), status: "CLOSED" };
}

import { describe, expect, it } from "vitest";
import {
  transition,
  expire,
  confirmStarted,
  closeStarted,
  RoomFault,
  type Room,
} from "../../src/rooms/domain/room.js";
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function initial(capacity = 3): Room {
  return {
    id: uid(10),
    gameId: "fixture",
    hostUserId: uid(1),
    capacity,
    version: 0,
    status: "WAITING",
    expiresAt: 1000,
    startedMatchId: null,
    members: [{ userId: uid(1), seat: 0, joinedAt: 0, joinedVersion: 0 }],
  };
}
describe("room state machine", () => {
  it("reserves two further revisions for start confirmation and terminal closure", () => {
    const full = transition(initial(2), uid(2), "join", 0, 10);
    expect(() =>
      transition({ ...full, version: 2147483645 }, uid(1), "start", 2147483645, 20),
    ).toThrow("ROOM_CONFLICT");
    const starting = transition({ ...full, version: 2147483644 }, uid(1), "start", 2147483644, 20);
    const started = confirmStarted(starting, 2147483645, uid(11));
    expect(closeStarted(started, uid(11)).version).toBe(2147483647);
  });
  it("creates a full room, transfers host to oldest member despite seat reuse and clock regression", () => {
    const source = initial();
    const two = transition(source, uid(2), "join", 0, 20);
    const three = transition(two, uid(3), "join", 1, 10);
    expect(source.members).toHaveLength(1);
    expect(three.status).toBe("FULL");
    const left = transition(three, uid(2), "leave", 2, 30);
    const rejoined = transition(left, uid(2), "join", 3, 30);
    const transferred = transition(rejoined, uid(1), "leave", 4, 30);
    expect(transferred.hostUserId).toBe(uid(3));
    expect(transferred.status).toBe("WAITING");
    expect(transferred.members.map((m) => m.seat)).toEqual([2, 1]);
  });
  it("uses a stable tie-break for legacy members with equal timestamps", () => {
    const room = initial(4);
    room.members.push(
      { userId: uid(3), seat: 1, joinedAt: 0, joinedVersion: 0 },
      { userId: uid(2), seat: 2, joinedAt: 0, joinedVersion: 0 },
    );
    expect(transition(room, uid(1), "leave", 0, 10).hostUserId).toBe(uid(2));
  });
  it("closes an empty room and preserves its historical host", () => {
    const result = transition(initial(), uid(1), "leave", 0, 10);
    expect(result).toMatchObject({ status: "CLOSED", version: 1, members: [], hostUserId: uid(1) });
  });
  it("joins existing members without duplicate seats or version changes", () => {
    const room = initial();
    expect(transition(room, uid(1), "join", 99, 10)).toBe(room);
  });
  it.each(["CLOSED", "EXPIRED", "STARTING", "STARTED"] as const)(
    "rejects membership mutation from %s",
    (status) => {
      const room = { ...initial(), status };
      for (const kind of ["join", "leave", "start"] as const)
        expect(() => transition(room, uid(1), kind, 0, 10)).toThrow(RoomFault);
    },
  );
  it("rejects stale versions, overflow, nonhost starts and nonmember leave", () => {
    const full = transition(initial(2), uid(2), "join", 0, 10);
    expect(() => transition(full, uid(3), "join", 1, 20)).toThrow("ROOM_CONFLICT");
    expect(() => transition(full, uid(2), "start", 1, 20)).toThrow("FORBIDDEN");
    expect(() => transition(full, uid(1), "start", 0, 20)).toThrow("ROOM_CONFLICT");
    expect(() => transition(full, uid(3), "leave", 1, 20)).toThrow("NOT_FOUND");
    expect(() => transition(initial(), uid(1), "start", 0, 20)).toThrow("ROOM_CONFLICT");
  });
  it("expires waiting/full rooms exactly at their deadline, once; never expires a starting match", () => {
    for (const room of [initial(), transition(initial(2), uid(2), "join", 0, 10)]) {
      expect(expire(room, 999)).toBe(room);
      const expired = expire(room, 1000);
      expect(expired.status).toBe("EXPIRED");
      expect(expire(expired, 1001)).toBe(expired);
      expect(() => transition(room, uid(1), "leave", room.version, 1000)).toThrow("ROOM_CONFLICT");
    }
    const full = transition(initial(2), uid(2), "join", 0, 10);
    const started = transition(full, uid(1), "start", 1, 999);
    expect(expire(started, 1000)).toBe(started);
  });
  it("requires a full host start before trusted confirmation and match-bound close", () => {
    const full = transition(initial(2), uid(2), "join", 0, 10);
    const starting = transition(full, uid(1), "start", 1, 20);
    expect(() => confirmStarted(full, 1, uid(11))).toThrow("ROOM_CONFLICT");
    const started = confirmStarted(starting, 2, uid(11));
    expect(confirmStarted(started, 2, uid(11))).toBe(started);
    expect(() => confirmStarted(started, 2, uid(12))).toThrow("ROOM_CONFLICT");
    expect(() => closeStarted(started, uid(12))).toThrow("ROOM_CONFLICT");
    const closed = closeStarted(started, uid(11));
    expect(closed.status).toBe("CLOSED");
    expect(closeStarted(closed, uid(11))).toBe(closed);
  });
  it("preserves capacity, unique membership/seats and host invariants across deterministic command sequences", () => {
    for (let capacity = 2; capacity <= 6; capacity++) {
      let room = initial(capacity);
      let changes = 0;
      for (let i = 0; i < 300; i++) {
        if (room.status === "CLOSED") room = initial(capacity);
        const actor = uid(1 + ((i * 17) % 9));
        const kind = Math.floor(i / 7) % 2 ? "leave" : "join";
        try {
          const before = room;
          room = transition(room, actor, kind, room.version, 100);
          if (before !== room) changes++;
        } catch (error) {
          expect(error).toBeInstanceOf(RoomFault);
        }
        expect(room.members.length).toBeLessThanOrEqual(capacity);
        expect(new Set(room.members.map((m) => m.userId)).size).toBe(room.members.length);
        expect(new Set(room.members.map((m) => m.seat)).size).toBe(room.members.length);
        if (room.members.length)
          expect(room.members.some((m) => m.userId === room.hostUserId)).toBe(true);
      }
      expect(changes).toBeGreaterThan(50);
    }
  });
});

it("fails closed at the PostgreSQL revision ceiling rather than wrapping", () => {
  const room = { ...initial(), version: 2147483647 };
  expect(() => transition(room, uid(2), "join", room.version, 10)).toThrow("ROOM_CONFLICT");
  expect(() => expire(room, 1000)).toThrow("ROOM_CONFLICT");
});

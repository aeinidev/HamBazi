import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { DatabaseError, type createDatabase } from "@hambazi/database";
import { createPrivateRoomMatchRepository } from "../../src/matches/infrastructure/repositories/private-room.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function fixture(failures: number, code = "DATABASE_TRANSACTION_CONFLICT") {
  const attempted: string[] = [];
  let active = false;
  const roomId = randomUUID(),
    matchId = randomUUID();
  const pins = { engineVersion: "test-v1", stateSchemaVersion: 1, rulesetVersion: "test-v1" };
  const players = [0, 1].map((seat) => ({ userId: randomUUID(), seat }));
  const readRows = vi.fn(async () =>
    players.map((player) => ({
      id: matchId,
      roomId,
      gameId: "coup",
      roomStartVersion: 2,
      matchType: "PRIVATE_ROOM",
      stateVersion: 0,
      status: "CREATED",
      ...pins,
      ...player,
      readyAt: null,
    })),
  );
  const execute = vi.fn(async (operation: (client: unknown) => Promise<unknown>) =>
    operation({ readPrivateRoomMatch: readRows }),
  );
  const database = {
    forModule: () => ({
      execute,
      async transaction(operation: (client: unknown) => Promise<unknown>, isolation: string) {
        attempted.push(isolation);
        active = true;
        try {
          if (attempted.length <= failures) throw new DatabaseError(code);
          return await operation({ readPrivateRoomMatch: readRows });
        } finally {
          active = false;
        }
      },
    }),
  } as unknown as ReturnType<typeof createDatabase>;
  const repository = createPrivateRoomMatchRepository(database, { clock: { nowMs: () => 1 } });
  return {
    attempted,
    readRows,
    execute,
    repository,
    roomId,
    active: () => active,
    run: () =>
      repository.create(
        {
          schemaVersion: 1,
          roomId,
          gameId: "coup",
          capacity: 2,
          startVersion: 2,
          status: "STARTING",
          startedMatchId: null,
          players,
        },
        pins,
        {},
      ),
  };
}

it("spreads retries after rollback without changing Serializable isolation, identity or the five-attempt bound", async () => {
  vi.useFakeTimers();
  const f = fixture(4);
  const delays: number[] = [];
  const original = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) => {
    expect(f.active()).toBe(false);
    delays.push(delay);
    return original(callback, delay);
  }) as typeof globalThis.setTimeout);
  const result = f.run();
  await vi.runAllTimersAsync();
  await expect(result).resolves.toMatchObject({ roomId: f.roomId });
  expect(f.attempted).toEqual(Array(5).fill("Serializable"));
  expect(f.readRows).toHaveBeenCalledExactlyOnceWith(f.roomId);
  expect(delays).toHaveLength(4);
  delays.forEach((delay, attempt) => {
    expect(delay).toBeGreaterThanOrEqual(10 * 2 ** attempt);
    expect(delay).toBeLessThanOrEqual(20 * 2 ** attempt);
  });
});

it("fails closed on exhaustion or ambiguous failure without unbounded retries", async () => {
  vi.useFakeTimers();
  for (const [failures, code, attempts] of [
    [5, "DATABASE_TRANSACTION_CONFLICT", 5],
    [5, "DATABASE_UNIQUE_CONFLICT", 5],
    [5, "DATABASE_OPERATION_FAILED", 1],
  ] as const) {
    const f = fixture(failures, code);
    const result = f.run().then(
      () => null,
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ code });
    expect(f.attempted).toHaveLength(attempts);
    expect(f.readRows).not.toHaveBeenCalled();
  }
});

it("reads metadata and readiness from one statement without a mutation transaction", async () => {
  const f = fixture(0);
  await expect(f.repository.read(f.roomId)).resolves.toMatchObject({
    roomId: f.roomId,
    status: "CREATED",
    readyUserIds: [],
    players: expect.any(Array),
  });
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.readRows).toHaveBeenCalledExactlyOnceWith(f.roomId);
  expect(f.attempted).toEqual([]);
});

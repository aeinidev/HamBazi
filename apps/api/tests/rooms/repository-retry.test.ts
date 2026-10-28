import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { DatabaseError, type createDatabase } from "@hambazi/database";
import { createRoomsRepository } from "../../src/rooms/infrastructure/repositories/rooms.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fixture(failures: number, code = "DATABASE_TRANSACTION_CONFLICT") {
  const attempted: string[] = [];
  const keys: string[] = [];
  let active = false;
  const database = {
    forModule: () => ({
      async transaction(operation: (client: unknown) => Promise<unknown>, isolation: string) {
        attempted.push(isolation);
        active = true;
        try {
          if (attempted.length <= failures) throw new DatabaseError(code);
          return await operation({
            lockRooms: async () => {},
            roomCommandReceipt: {
              findUnique: async (input: {
                where: { actorUserId_commandId: { commandId: string } };
              }) => {
                keys.push(input.where.actorUserId_commandId.commandId);
                return null;
              },
            },
          });
        } finally {
          active = false;
        }
      },
    }),
  } as unknown as ReturnType<typeof createDatabase>;
  const repository = createRoomsRepository(database, {
    clock: { nowMs: () => 1 },
    ttlSeconds: 900,
  });
  const commandId = randomUUID();
  return {
    attempted,
    keys,
    active: () => active,
    commandId,
    run: () =>
      repository.receipt(randomUUID(), "create", {
        schemaVersion: 1,
        commandId,
        gameId: "coup",
        capacity: 2,
      }),
  };
}

it("uses a read-only snapshot for recovery while retaining the Room lock on ordinary reads", async () => {
  const db = { lockRooms: vi.fn(async () => {}), room: { findUnique: vi.fn(async () => null) } };
  const snapshot = vi.fn(async (operation: (client: typeof db) => unknown) => operation(db));
  const transaction = vi.fn(async (operation: (client: typeof db) => unknown) => operation(db));
  const database = { forModule: () => ({ snapshot, transaction }) } as unknown as ReturnType<
    typeof createDatabase
  >;
  const repository = createRoomsRepository(database, {
    clock: { nowMs: () => 1 },
    ttlSeconds: 900,
  });
  const id = randomUUID();
  await expect(repository.startSnapshot(id)).resolves.toBeNull();
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(transaction).not.toHaveBeenCalled();
  expect(db.lockRooms).not.toHaveBeenCalled();
  await expect(repository.read(id)).resolves.toBeNull();
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(db.lockRooms).toHaveBeenCalledTimes(1);
});

it("backs off only after rollback and retains Serializable isolation and the five-attempt bound", async () => {
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
  await expect(result).resolves.toBeNull();
  expect(f.attempted).toEqual(Array(5).fill("Serializable"));
  expect(f.keys).toEqual([f.commandId]);
  expect(delays).toHaveLength(4);
  delays.forEach((delay, attempt) => {
    expect(delay).toBeGreaterThanOrEqual(10 * 2 ** attempt);
    expect(delay).toBeLessThanOrEqual(20 * 2 ** attempt);
  });
});

it("fails closed after five conflicts and does not retry an ambiguous database failure", async () => {
  vi.useFakeTimers();
  for (const [failures, code, attempts] of [
    [5, "DATABASE_TRANSACTION_CONFLICT", 5],
    [5, "DATABASE_OPERATION_FAILED", 1],
  ] as const) {
    const f = fixture(failures, code);
    // Attach the rejection handler before advancing time.
    const result = f.run().then(
      () => null,
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ code });
    expect(f.attempted).toHaveLength(attempts);
    expect(f.keys).toEqual([]);
  }
});

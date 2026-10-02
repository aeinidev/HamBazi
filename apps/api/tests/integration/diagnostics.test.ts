import { createDatabase } from "@hambazi/database";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createMatchDiagnostics, createOutboxDiagnostics } from "../../src/matches/index.js";
import { createRoomDiagnostics } from "../../src/rooms/index.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
  !process.env.API_DATABASE_URL
)
  throw new Error("Use isolated test:auth-http:local harness");
const database = createDatabase({
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
  poolMax: 1,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
  observe() {
    throw new Error("PRIVATE_OBSERVER");
  },
});
beforeAll(() => database.connect());
afterAll(() => database.disconnect());
it("reads only fixed numeric aggregate diagnostics from populated owning storage", async () => {
  const matches = await createMatchDiagnostics(database)();
  expect(matches.matches_active).toBe(
    await database
      .forModule("matches")
      .execute((db) => db.match.count({ where: { status: "ACTIVE" } })),
  );
  expect(matches.matches_finished).toBeGreaterThan(0);
  expect((await createRoomDiagnostics(database)()).rooms_waiting).toBe(
    await database
      .forModule("rooms")
      .execute((db) => db.room.count({ where: { status: "WAITING" } })),
  );
  const outbox = await createOutboxDiagnostics(database)();
  expect(outbox.outbox_pending).toBe(
    await database
      .forModule("outbox")
      .execute((db) => db.outboxEvent.count({ where: { status: "PENDING" } })),
  );
  expect(
    Object.values({ ...matches, ...outbox }).every(
      (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
    ),
  ).toBe(true);
  expect(JSON.stringify({ ...matches, ...outbox })).not.toMatch(
    /payload|stateJsonb|userId|matchId|PRIVATE/,
  );
});
it("measures real pool saturation and preserves accepted work despite observer failure", async () => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
    enter = r;
  });
  const latch = new Promise<void>((r) => {
    release = r;
  });
  const held = database.forModule("users").transaction(async (db) => {
    await db.user.count();
    enter();
    await latch;
  });
  await entered;
  const waiting = database.probe();
  try {
    for (let i = 0; i < 100 && database.poolSnapshot().waiting === 0; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(database.poolSnapshot()).toMatchObject({ max: 1, total: 1, idle: 0, waiting: 1 });
  } finally {
    release();
    await held;
  }
  expect(await waiting).toBe(true);
  expect(database.poolSnapshot()).toMatchObject({ total: 1, idle: 1, waiting: 0 });
});

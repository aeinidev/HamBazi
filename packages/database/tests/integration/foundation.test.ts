import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/index.js";

// Never skip silently or run against the normal application database.
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  !process.env.TEST_DATABASE_URL
) {
  throw new Error(
    "Use test:local or supply an isolated database with TEST_DATABASE_CONFIRM=isolated-hambazi-test.",
  );
}
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const api = new pg.Client({ connectionString: process.env.API_DATABASE_URL });
const worker = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL });
const userId = randomUUID();
const matchId = randomUUID();
const gameId = `test-${process.env.TEST_DATABASE_RUN_ID ?? randomUUID()}`;
const options = {
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
  poolMax: 2,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 2000,
  transactionTimeoutMs: 5000,
};
const database = createDatabase(options);
async function sqlState(
  client: pg.Client,
  sql: string,
  values: unknown[] = [],
): Promise<string | undefined> {
  try {
    await client.query(sql, values);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

beforeAll(async () => {
  await Promise.all([admin.connect(), api.connect(), worker.connect(), database.connect()]);
  // Refuse a populated target before any fixture write or negative mutation test.
  const occupied = await admin.query(
    "SELECT EXISTS (SELECT 1 FROM users UNION ALL SELECT 1 FROM games UNION ALL SELECT 1 FROM matches UNION ALL SELECT 1 FROM game_events UNION ALL SELECT 1 FROM outbox_events UNION ALL SELECT 1 FROM consumer_receipts) AS occupied",
  );
  if (occupied.rows[0].occupied)
    throw new Error("Integration tests require an empty isolated database.");
  await admin.query(
    "INSERT INTO games (id,slug,title,min_players,max_players,matchmaking_enabled,private_rooms_enabled,chat_enabled,voice_enabled,status,config_schema_version,config_jsonb,updated_at) VALUES ($1,$1,'Test',2,6,true,true,true,false,'ACTIVE',1,'{}',now())",
    [gameId],
  );
  await api.query(
    "INSERT INTO users (id,telegram_user_id,display_name,public_handle,status,updated_at) VALUES ($1,9007199254740993,'Test',$2,'ACTIVE',now())",
    [userId, gameId],
  );
  await api.query(
    "INSERT INTO matches (id,game_id,match_type,status,engine_version,state_schema_version,ruleset_version,state_jsonb,updated_at) VALUES ($1,$2,'TEST','ACTIVE','test-v1',1,'test-v1','{}',now())",
    [matchId, gameId],
  );
  await api.query(
    "INSERT INTO match_players (match_id,user_id,seat,agent_type,connection_status) VALUES ($1,$2,0,'HUMAN','CONNECTED')",
    [matchId, userId],
  );
});
afterAll(async () => {
  await Promise.all([admin.end(), api.end(), worker.end(), database.disconnect()]);
});

describe("PostgreSQL foundation", () => {
  it("preserves Telegram identifiers beyond JavaScript's safe integer range", async () => {
    const user = await database
      .forModule("users")
      .execute((db) => db.user.findUniqueOrThrow({ where: { id: userId } }));
    expect(user.telegramUserId).toBe(9007199254740993n);
  });
  it("enforces unique Telegram IDs and public handles", async () => {
    const sql =
      "INSERT INTO users (id,telegram_user_id,display_name,public_handle,status,updated_at) VALUES ($1,$2,'Test',$3,'ACTIVE',now())";
    expect(await sqlState(api, sql, [randomUUID(), "9007199254740993", randomUUID()])).toBe(
      "23505",
    );
    expect(await sqlState(api, sql, [randomUUID(), "8", gameId])).toBe("23505");
  });
  it("enforces foreign keys, seat uniqueness, and positive schema versions", async () => {
    expect(
      await sqlState(
        api,
        "INSERT INTO match_players (match_id,user_id,seat,agent_type,connection_status) VALUES ($1,$2,0,'HUMAN','CONNECTED')",
        [randomUUID(), userId],
      ),
    ).toBe("23503");
    expect(
      await sqlState(
        api,
        "INSERT INTO match_players (match_id,user_id,seat,agent_type,connection_status) VALUES ($1,$2,0,'HUMAN','CONNECTED')",
        [matchId, userId],
      ),
    ).toBe("23505");
    expect(
      await sqlState(
        api,
        "INSERT INTO game_events (id,match_id,seq,schema_version,type,payload_jsonb) VALUES ($1,$2,0,1,'Test','{}')",
        [randomUUID(), matchId],
      ),
    ).toBe("23514");
  });
  it("prevents silent engine/version changes and unversioned state writes", async () => {
    expect(
      await sqlState(api, "UPDATE matches SET engine_version='test-v2' WHERE id=$1", [matchId]),
    ).toBe("23514");
    expect(
      await sqlState(api, "UPDATE matches SET state_jsonb='{\"stage\":1}' WHERE id=$1", [matchId]),
    ).toBe("23514");
    expect(await sqlState(api, "UPDATE matches SET state_version=-1 WHERE id=$1", [matchId])).toBe(
      "23514",
    );
  });
  it("makes duplicate action IDs a concurrent single-winner constraint", async () => {
    const actionId = randomUUID();
    const sql =
      "INSERT INTO processed_commands (match_id,action_id,actor_user_id,schema_version,expected_version,resulting_version,result_jsonb) VALUES ($1,$2,$3,1,0,0,'{}')";
    const results = await Promise.all([
      sqlState(api, sql, [matchId, actionId, userId]),
      sqlState(worker, sql, [matchId, actionId, userId]),
    ]);
    expect(results.filter((value) => value === undefined)).toHaveLength(1);
    expect(results.filter((value) => value === "23505")).toHaveLength(1);
  });
  it("commits snapshot, event, command, and outbox together", async () => {
    const actionId = randomUUID();
    const outboxId = randomUUID();
    await database.forModule("matches").transaction(async (db) => {
      await db.match.update({
        where: { id: matchId },
        data: { stateJsonb: { stage: 1 }, stateVersion: 1, lastEventSeq: 1 },
      });
      await db.gameEvent.create({
        data: {
          id: randomUUID(),
          matchId,
          seq: 1,
          schemaVersion: 1,
          type: "Test",
          payloadJsonb: {},
        },
      });
      await db.processedCommand.create({
        data: {
          matchId,
          actionId,
          actorUserId: userId,
          schemaVersion: 1,
          expectedVersion: 0,
          resultingVersion: 1,
          resultJsonb: {},
        },
      });
      await db.outboxEvent.create({
        data: {
          id: outboxId,
          aggregateId: matchId,
          type: "Test",
          schemaVersion: 1,
          payloadJsonb: {},
          status: "PENDING",
        },
      });
    });
    const rows = await admin.query(
      "SELECT state_version,(SELECT count(*) FROM game_events WHERE match_id=$1)::int AS events,(SELECT count(*) FROM outbox_events WHERE id=$2)::int AS outbox FROM matches WHERE id=$1",
      [matchId, outboxId],
    );
    expect(rows.rows[0]).toEqual({ state_version: 1, events: 1, outbox: 1 });
  });
  it("rolls back all four writes after a late failure", async () => {
    const actionId = randomUUID();
    const outboxId = randomUUID();
    await expect(
      database.forModule("matches").transaction(async (db) => {
        await db.match.update({
          where: { id: matchId },
          data: { stateJsonb: { stage: 2 }, stateVersion: 2, lastEventSeq: 2 },
        });
        await db.gameEvent.create({
          data: {
            id: randomUUID(),
            matchId,
            seq: 2,
            schemaVersion: 1,
            type: "Test",
            payloadJsonb: {},
          },
        });
        await db.processedCommand.create({
          data: {
            matchId,
            actionId,
            actorUserId: userId,
            schemaVersion: 1,
            expectedVersion: 1,
            resultingVersion: 2,
            resultJsonb: {},
          },
        });
        await db.outboxEvent.create({
          data: {
            id: outboxId,
            aggregateId: matchId,
            type: "Test",
            schemaVersion: 1,
            payloadJsonb: {},
            status: "PENDING",
          },
        });
        throw new Error("synthetic failure");
      }),
    ).rejects.toMatchObject({ code: "DATABASE_OPERATION_FAILED" });
    const rows = await admin.query(
      "SELECT state_version,(SELECT count(*) FROM game_events WHERE match_id=$1 AND seq=2)::int AS events,(SELECT count(*) FROM outbox_events WHERE id=$2)::int AS outbox,(SELECT count(*) FROM processed_commands WHERE match_id=$1 AND action_id=$3)::int AS commands FROM matches WHERE id=$1",
      [matchId, outboxId, actionId],
    );
    expect(rows.rows[0]).toEqual({ state_version: 1, events: 0, outbox: 0, commands: 0 });
  });
  it("enforces event ordering uniqueness and append-only history", async () => {
    expect(
      await sqlState(
        api,
        "INSERT INTO game_events (id,match_id,seq,schema_version,type,payload_jsonb) VALUES ($1,$2,1,1,'Test','{}')",
        [randomUUID(), matchId],
      ),
    ).toBe("23505");
    expect(await sqlState(api, "DELETE FROM game_events WHERE match_id=$1", [matchId])).toBe(
      "42501",
    );
    expect(await sqlState(admin, "DELETE FROM game_events WHERE match_id=$1", [matchId])).toBe(
      "23514",
    );
    expect(await sqlState(admin, "TRUNCATE game_events")).toBe("23514");
    expect(
      await sqlState(admin, "UPDATE processed_commands SET result_jsonb='{}' WHERE match_id=$1", [
        matchId,
      ]),
    ).toBe("23514");
  });
  it("restricts role privileges and outbox updates", async () => {
    expect(await sqlState(api, "CREATE TABLE forbidden (id int)")).toBe("42501");
    expect(await sqlState(worker, "SELECT * FROM users")).toBe("42501");
    expect(await sqlState(worker, "SELECT * FROM chat_messages")).toBe("42501");
    expect(await sqlState(api, "SELECT * FROM _prisma_migrations")).toBe("42501");
    expect(await sqlState(worker, "UPDATE outbox_events SET payload_jsonb='{}'")).toBe("42501");
    expect(
      await sqlState(
        worker,
        "UPDATE outbox_events SET status='PUBLISHED',published_at=now(),attempts=attempts+1",
      ),
    ).toBeUndefined();
  });
  it("deduplicates consumer effects per consumer and event", async () => {
    const eventId = randomUUID();
    const sql = "INSERT INTO consumer_receipts (consumer,event_id) VALUES ($1,$2)";
    expect(await sqlState(worker, sql, [gameId, eventId])).toBeUndefined();
    expect(await sqlState(worker, sql, [gameId, eventId])).toBe("23505");
    expect(await sqlState(worker, sql, [gameId + "-other", eventId])).toBeUndefined();
  });
});

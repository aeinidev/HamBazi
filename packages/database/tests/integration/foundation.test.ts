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
const sessionId = randomUUID();
const sessionCommandId = randomUUID();
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
    "SELECT EXISTS (SELECT 1 FROM users UNION ALL SELECT 1 FROM games WHERE id <> 'coup' UNION ALL SELECT 1 FROM matches UNION ALL SELECT 1 FROM game_events UNION ALL SELECT 1 FROM outbox_events UNION ALL SELECT 1 FROM consumer_receipts) AS occupied",
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
  it("seeds a disabled catalog once and preserves existing configuration on replay", async () => {
    const { readFile } = await import("node:fs/promises");
    const migration = await readFile(
      new URL(
        "../../prisma/migrations/202609220002_catalog_baseline/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const initial = await admin.query("SELECT * FROM games WHERE id='coup'");
    expect(initial.rows).toHaveLength(1);
    expect(initial.rows[0]).toMatchObject({
      slug: "coup",
      title: "Coup",
      min_players: 2,
      max_players: 6,
      status: "DISABLED",
      matchmaking_enabled: false,
      private_rooms_enabled: false,
      chat_enabled: false,
      voice_enabled: false,
      config_schema_version: 1,
      config_jsonb: {},
    });
    await admin.query("BEGIN");
    try {
      await admin.query("UPDATE games SET status='MAINTENANCE' WHERE id='coup'");
      await admin.query(migration);
      expect((await admin.query("SELECT status FROM games WHERE id='coup'")).rows[0].status).toBe(
        "MAINTENANCE",
      );
      for (const role of [api, worker]) {
        expect(await sqlState(role, "UPDATE games SET status='ACTIVE' WHERE id='coup'")).toBe(
          "42501",
        );
        expect(await sqlState(role, "DELETE FROM games WHERE id='coup'")).toBe("42501");
      }
    } finally {
      await admin.query("ROLLBACK");
    }
  });
  it("limits onboarding metadata to API-owned tables and excludes content columns", async () => {
    for (const table of ["bot_update_receipts", "bot_onboarding_flows"]) {
      expect(await sqlState(worker, `SELECT id, expires_at FROM ${table}`)).toBeUndefined();
      expect(await sqlState(worker, `SELECT telegram_user_id FROM ${table}`)).toBe("42501");
      expect(await sqlState(worker, `SELECT * FROM ${table}`)).toBe("42501");
      expect(await sqlState(worker, `UPDATE ${table} SET expires_at=now()`)).toBe("42501");
      expect(await sqlState(worker, `DELETE FROM ${table} WHERE false`)).toBeUndefined();
      const columns = await admin.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
        [table],
      );
      expect(columns.rows.map((row) => row.column_name).join(" ")).not.toMatch(
        /text|payload|name|token|secret|hash|json/,
      );
    }
    const receipt = randomUUID();
    const at = "2026-09-01T00:00:00Z";
    const insert =
      "INSERT INTO bot_update_receipts (id,bot_id,update_id,telegram_user_id,message_id,schema_version,action,phase,version,received_at,expires_at,lease_until) VALUES ($1,123,999,111,1,1,'START','PROCESSING',1,$2,$3,$2::timestamptz+interval '5 seconds')";
    expect(await sqlState(api, insert, [receipt, at, "2026-09-08T00:00:00Z"])).toBeUndefined();
    expect(await sqlState(api, insert, [randomUUID(), at, "2026-09-08T00:00:00Z"])).toBe("23505");
    expect(
      await sqlState(
        api,
        "UPDATE bot_update_receipts SET expires_at=expires_at+interval '1 day' WHERE id=$1",
        [receipt],
      ),
    ).toBe("42501");
    expect(
      await sqlState(
        admin,
        "UPDATE bot_update_receipts SET received_at=received_at+interval '1 day',expires_at=expires_at+interval '1 day' WHERE id=$1",
        [receipt],
      ),
    ).toBe("23514");
    expect(
      await sqlState(api, "UPDATE bot_update_receipts SET phase='UNKNOWN' WHERE id=$1", [receipt]),
    ).toBe("23514");
    expect(
      await sqlState(api, "UPDATE bot_update_receipts SET version=version+2 WHERE id=$1", [
        receipt,
      ]),
    ).toBe("23514");
    expect(
      await sqlState(api, "DELETE FROM bot_update_receipts WHERE id=$1", [receipt]),
    ).toBeUndefined();
    // Retention is elapsed time, independent of the database session's DST calendar.
    await api.query("SET TIME ZONE 'America/New_York'");
    try {
      expect(
        await sqlState(api, insert, [receipt, "2026-03-07T12:00:00Z", "2026-03-14T12:00:00Z"]),
      ).toBeUndefined();
      await api.query("DELETE FROM bot_update_receipts WHERE id=$1", [receipt]);
    } finally {
      await api.query("RESET TIME ZONE");
    }
    const flow = randomUUID();
    const createFlow =
      "INSERT INTO bot_onboarding_flows (id,bot_id,telegram_user_id,schema_version,version,state,created_at,expires_at,prompt_version) VALUES ($1,123,111,1,1,'WAITING',$2,$3,1)";
    expect(await sqlState(api, createFlow, [flow, at, "2026-09-01T00:15:00Z"])).toBeUndefined();
    expect(
      await sqlState(api, "UPDATE bot_onboarding_flows SET version=version+2 WHERE id=$1", [flow]),
    ).toBe("23514");
    expect(
      await sqlState(
        api,
        "UPDATE bot_onboarding_flows SET state='SUBMITTING',version=version+1 WHERE id=$1",
        [flow],
      ),
    ).toBe("23514");
    expect(
      await sqlState(
        api,
        "UPDATE bot_onboarding_flows SET expires_at=expires_at+interval '1 minute' WHERE id=$1",
        [flow],
      ),
    ).toBe("42501");
    expect(
      await sqlState(api, "DELETE FROM bot_onboarding_flows WHERE id=$1", [flow]),
    ).toBeUndefined();
  });
  it("inserts valid Auth metadata with only the API role", async () => {
    expect(
      await sqlState(
        api,
        "INSERT INTO sessions (id,user_id,command_id,schema_version,key_id,issuer,audience,issued_at,expires_at) VALUES ($1,$2,$3,1,'synthetic','test-api','test-app','2026-01-01T00:00:00Z','2026-01-01T00:01:00Z')",
        [sessionId, userId, sessionCommandId],
      ),
    ).toBeUndefined();
    expect(await sqlState(worker, "SELECT id FROM sessions")).toBe("42501");
    expect(await sqlState(worker, "UPDATE sessions SET revoked_at=now()")).toBe("42501");
    expect(await sqlState(api, "DELETE FROM sessions WHERE id=$1", [sessionId])).toBe("42501");
  });
  it("enforces session command uniqueness, foreign keys, and lifetime constraints", async () => {
    const insert =
      "INSERT INTO sessions (id,user_id,command_id,schema_version,key_id,issuer,audience,issued_at,expires_at) VALUES ($1,$2,$3,1,'test','api','app',$4,$5)";
    const start = "2026-01-01T00:00:00Z",
      end = "2026-01-01T00:01:00Z";
    expect(await sqlState(api, insert, [randomUUID(), userId, sessionCommandId, start, end])).toBe(
      "23505",
    );
    expect(
      await sqlState(api, insert, [randomUUID(), randomUUID(), randomUUID(), start, end]),
    ).toBe("23503");
    expect(await sqlState(api, insert, [randomUUID(), userId, randomUUID(), end, start])).toBe(
      "23514",
    );
    expect(
      await sqlState(api, insert, [randomUUID(), userId, randomUUID(), start, "infinity"]),
    ).toBe("23514");
  });
  it("permits one-way revocation but prevents expiry extension and resurrection", async () => {
    expect(
      await sqlState(
        api,
        "UPDATE sessions SET expires_at=expires_at+interval '1 day' WHERE id=$1",
        [sessionId],
      ),
    ).toBe("42501");
    expect(
      await sqlState(
        admin,
        "UPDATE sessions SET expires_at=expires_at+interval '1 day' WHERE id=$1",
        [sessionId],
      ),
    ).toBe("23514");
    expect(
      await sqlState(api, "UPDATE sessions SET revoked_at='2026-01-01T00:00:30Z' WHERE id=$1", [
        sessionId,
      ]),
    ).toBeUndefined();
    expect(
      await sqlState(api, "UPDATE sessions SET revoked_at=NULL WHERE id=$1", [sessionId]),
    ).toBe("23514");
    expect(
      await sqlState(api, "UPDATE sessions SET revoked_at='2026-01-01T00:00:31Z' WHERE id=$1", [
        sessionId,
      ]),
    ).toBe("23514");
  });
  it("rolls back a failed session metadata transaction", async () => {
    const before = await database.forModule("auth").execute((db) => db.session.count());
    await expect(
      database.forModule("auth").transaction(async (db) => {
        await db.session.create({
          data: {
            id: randomUUID(),
            userId,
            commandId: randomUUID(),
            schemaVersion: 1,
            keyId: "test",
            issuer: "api",
            audience: "app",
            issuedAt: new Date("2026-01-01T00:00:00Z"),
            expiresAt: new Date("2026-01-01T00:01:00Z"),
          },
        });
        throw new Error("Synthetic rollback");
      }),
    ).rejects.toMatchObject({ code: "DATABASE_OPERATION_FAILED" });
    expect(await database.forModule("auth").execute((db) => db.session.count())).toBe(before);
  });
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

it("atomically deduplicates consumer effects across clients and rolls back failed effects/receipts", async () => {
  const one = createDatabase({
    ...options,
    databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
  });
  const two = createDatabase({
    ...options,
    databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
  });
  const consumer = `fixture-${randomUUID()}`;
  const eventId = randomUUID();
  const identity = { userId, gameId, metric: "synthetic_consumer", period: "test" };
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        (i % 2 ? one : two).forModule("leaderboard").consumeOnce(consumer, eventId, async (db) => {
          await db.userGameStats.upsert({
            where: { userId_gameId_metric_period: identity },
            create: { ...identity, value: 1n },
            update: { value: { increment: 1n } },
          });
        }),
      ),
    );
    expect(results.filter((r) => r === "APPLIED")).toHaveLength(1);
    expect(results.filter((r) => r === "DUPLICATE")).toHaveLength(7);
    const failedId = randomUUID();
    await expect(
      one.forModule("leaderboard").consumeOnce(consumer, failedId, async (db) => {
        await db.userGameStats.update({
          where: { userId_gameId_metric_period: identity },
          data: { value: { increment: 10n } },
        });
        throw new Error("synthetic rollback");
      }),
    ).rejects.toThrow();
    expect(
      await one
        .forModule("leaderboard")
        .execute((db) => db.consumerReceipt.count({ where: { consumer, eventId: failedId } })),
    ).toBe(0);
    expect(
      (
        await one.forModule("leaderboard").execute((db) =>
          db.userGameStats.findUniqueOrThrow({
            where: { userId_gameId_metric_period: identity },
          }),
        )
      ).value,
    ).toBe(1n);
    expect(
      await two.forModule("leaderboard").consumeOnce(consumer, failedId, async (db) => {
        await db.userGameStats.update({
          where: { userId_gameId_metric_period: identity },
          data: { value: { increment: 1n } },
        });
      }),
    ).toBe("APPLIED");
  } finally {
    await one.disconnect();
    await two.disconnect();
  }
});

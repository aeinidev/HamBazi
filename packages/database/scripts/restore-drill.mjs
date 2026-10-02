import { execFile } from "node:child_process";
import { promisify, isDeepStrictEqual } from "node:util";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
const run = promisify(execFile);
export class RestoreDrillError extends Error {
  constructor(stage) {
    super("Restore drill failed");
    this.stage = stage;
  }
}
/** Only called with the disposable cluster created by test-local.mjs. Never targets a supplied live DB. */
export async function restoreDrill({ bin, path, env }) {
  if (
    env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
    env.PGHOST !== "127.0.0.1" ||
    env.POSTGRES_DB !== "hambazi"
  )
    throw new Error("Invalid restore drill environment");
  let stage = "source snapshot";
  try {
    const target = "hambazi_restore_drill";
    const file = join(path, "restore-drill.dump");
    const source = env.TEST_DATABASE_URL;
    const restoredUrl = new URL(source);
    restoredUrl.pathname = `/${target}`;
    async function snapshot(url) {
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        const tables = await client.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
        );
        const rows = {};
        for (const { tablename } of tables.rows) {
          if (!/^[a-z_]+$/.test(tablename)) throw new Error("Invalid drill table");
          // Hash in the DB; hidden application data is never returned or logged by the drill.
          const result = await client.query(
            `SELECT count(*)::text AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS digest FROM "${tablename}" t`,
          );
          rows[tablename] = result.rows[0];
        }
        // PostgreSQL's pretty deparser removes redundant associative AND parentheses
        // introduced by a dump/reparse while preserving expression semantics.
        const constraints = await client.query(
          "SELECT conname, contype, pg_get_constraintdef(oid, true) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conname, definition",
        );
        const triggers = await client.query(
          "SELECT tgname, pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace) ORDER BY tgname, definition",
        );
        const grants = await client.query(
          "SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' ORDER BY grantee, table_name, privilege_type",
        );
        const columns = await client.query(
          "SELECT grantee, table_name, column_name, privilege_type FROM information_schema.column_privileges WHERE table_schema='public' ORDER BY grantee, table_name, column_name, privilege_type",
        );
        return {
          rows,
          constraints: constraints.rows,
          triggers: triggers.rows,
          grants: grants.rows,
          columns: columns.rows,
        };
      } finally {
        await client.end();
      }
    }
    const before = await snapshot(source);
    if (!before.rows.game_events || before.rows.game_events.count === "0")
      throw new Error("Populated drill fixture required");
    const child = { env, timeout: 30000, maxBuffer: 1024 * 1024 };
    stage = "dump";
    await run(
      join(bin, "pg_dump"),
      [
        "--host",
        env.PGHOST,
        "--port",
        env.PGPORT,
        "--username",
        env.POSTGRES_USER,
        "--dbname",
        "hambazi",
        "--no-password",
        "--format=custom",
        "--file",
        file,
      ],
      child,
    );
    await chmod(file, 0o600);
    stage = "create destination";
    const admin = new pg.Client({ connectionString: source });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${target}`);
    } finally {
      await admin.end();
    }
    stage = "restore archive";
    await run(
      join(bin, "pg_restore"),
      [
        "--host",
        env.PGHOST,
        "--port",
        env.PGPORT,
        "--username",
        env.POSTGRES_USER,
        "--dbname",
        target,
        "--no-password",
        "--exit-on-error",
        file,
      ],
      child,
    );
    const after = await snapshot(restoredUrl.href);
    for (const part of ["rows", "constraints", "triggers", "grants", "columns"]) {
      stage = `reconcile ${part}`;
      if (!isDeepStrictEqual(before[part], after[part])) {
        throw new Error("Restore reconciliation failed");
      }
    }
    stage = "append-only guard";
    const restored = new pg.Client({ connectionString: restoredUrl.href });
    await restored.connect();
    try {
      await restored.query("BEGIN");
      let denied = false;
      try {
        await restored.query(
          "DELETE FROM game_events WHERE id=(SELECT id FROM game_events LIMIT 1)",
        );
      } catch {
        denied = true;
      }
      await restored.query("ROLLBACK");
      if (!denied) throw new Error("Restored append-only guard missing");
    } finally {
      await restored.end();
    }
    // Check real application credentials against the restored grants; no live clients are redirected.
    stage = "application credentials";
    for (const key of ["API_DATABASE_URL", "WORKER_DATABASE_URL"]) {
      const url = new URL(env[key]);
      url.pathname = `/${target}`;
      const client = new pg.Client({ connectionString: url.href });
      await client.connect();
      try {
        await client.query("SELECT count(*) FROM matches");
      } finally {
        await client.end();
      }
    }
    stage = "source preservation";
    if (!isDeepStrictEqual(before, await snapshot(source)))
      throw new Error("Source changed during restore drill");
    return Object.freeze({ tables: Object.keys(before.rows).length });
  } catch {
    throw new RestoreDrillError(stage);
  }
}

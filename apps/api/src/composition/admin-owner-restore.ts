import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import type { OwnerBackupCapsule } from "./admin-owner-backup.js";

const image = "postgres@sha256:3725f4e2499eef5134592b3b4ab79a543ed7f8e533b05b5b637af926630f6650";
const execute = promisify(execFile);
const local = {
  ...process.env,
  DOCKER_HOST: "unix:///var/run/docker.sock",
  DOCKER_CONTEXT: "",
  DOCKER_TLS_VERIFY: "",
  DOCKER_CERT_PATH: "",
};
const args = ["--host", "unix:///var/run/docker.sock"];

/** No target URL, host mount, external network or existing container is accepted. */
export async function rehearseOwnerRestore(capsule: OwnerBackupCapsule) {
  const name = "hambazi-owner-restore-" + randomUUID();
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  for (const event of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(event, stop);
  const run = async (command: string[]) => {
    if (stopped) throw new Error();
    const value = await execute("docker", [...args, ...command], {
      env: local,
      timeout: 30000,
      maxBuffer: 65536,
    });
    if (stopped) throw new Error();
    return value;
  };
  const pipe = (command: string[], input: Buffer | string) =>
    new Promise<string>((resolve, reject) => {
      if (stopped) {
        reject(new Error("ADMIN_RESTORE_REHEARSAL_DENIED"));
        return;
      }
      const child = spawn("docker", [...args, "exec", "--interactive", name, ...command], {
        env: local,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("ADMIN_RESTORE_REHEARSAL_DENIED"));
      }, 30000);
      child.stdout.on("data", (chunk: Buffer) => {
        if (output.length < 65536) output += chunk.toString();
      });
      // PostgreSQL errors can contain row values. Drain without printing/persisting.
      child.stderr.resume();
      child.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("ADMIN_RESTORE_REHEARSAL_DENIED"));
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (code === 0 && !stopped) resolve(output);
        else reject(new Error("ADMIN_RESTORE_REHEARSAL_DENIED"));
      });
      child.stdin.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("ADMIN_RESTORE_REHEARSAL_DENIED"));
      });
      child.stdin.end(input);
    });
  const sql = (text: string) =>
    pipe(
      [
        "psql",
        "--username=postgres",
        "--dbname=postgres",
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "--set=ON_ERROR_STOP=1",
      ],
      text,
    );
  let outcome: { ownerPresent: boolean; tableRows: number[] } | undefined;
  let failed = false,
    cleanupFailed = false;
  try {
    await run([
      "run",
      "--detach",
      "--rm",
      "--pull=never",
      "--name",
      name,
      "--label=hambazi.purpose=disposable-owner-restore",
      "--network=none",
      "--log-driver=none",
      "--pids-limit=64",
      "--memory=384m",
      "--cpus=0.5",
      "--env=POSTGRES_HOST_AUTH_METHOD=trust",
      "--tmpfs=/var/lib/postgresql:rw,nosuid,size=512m",
      image,
    ]);
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        await run(["exec", name, "pg_isready", "--host=127.0.0.1", "--username=postgres"]);
        ready = true;
        break;
      } catch {
        if (stopped) throw new Error();
        await wait(200);
      }
    }
    if (!ready) throw new Error();
    const schema = await readFile(
      new URL(
        "../../../../packages/database/prisma/migrations/202610250001_admin_local_identity/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const rotation = await readFile(
      new URL(
        "../../../../packages/database/prisma/migrations/202610260001_admin_password_rotation/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    // Restore both archive generations into the current additive identity schema.
    const managementSchema = await readFile(
      new URL(
        "../../../../packages/database/prisma/migrations/202610270001_admin_management/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const noteSchema = await readFile(
      new URL(
        "../../../../packages/database/prisma/migrations/202610280001_admin_private_notes/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const grants = await readFile(
      new URL("../../../../packages/database/prisma/admin-permissions.sql", import.meta.url),
      "utf8",
    );
    const stagingGrants = await readFile(
      new URL(
        "../../../../packages/database/prisma/admin-staging-owner-permissions.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await sql(
      "CREATE ROLE hambazi_admin_runtime NOLOGIN; CREATE ROLE hambazi_admin_bootstrap NOLOGIN; CREATE ROLE hambazi_admin_recovery NOLOGIN;\n" +
        schema +
        "\n" +
        rotation +
        "\n" +
        managementSchema +
        "\n" +
        noteSchema +
        "\n" +
        grants.split("-- Metadata only:")[0] +
        "\nCOMMIT;\n" +
        stagingGrants,
    );
    await pipe(
      [
        "pg_restore",
        "--username=postgres",
        "--dbname=postgres",
        "--data-only",
        "--disable-triggers",
        "--single-transaction",
        "--exit-on-error",
        "--no-owner",
        "--no-acl",
      ],
      Buffer.from(capsule.dumpBase64, "base64"),
    );
    if (managementSchema) {
      const invalid = await sql(
        "SELECT (SELECT count(*) FROM admin_roles WHERE realm_id<>'staging') + (SELECT count(*) FROM admin_operator_roles m LEFT JOIN admin_roles r ON r.id=m.role_id AND r.realm_id=m.realm_id LEFT JOIN admin_operators o ON o.id=m.operator_id AND o.realm_id=m.realm_id WHERE o.id IS NULL OR r.id IS NULL OR m.realm_id<>'staging') + (SELECT count(*) FROM admin_operations c LEFT JOIN admin_operators o ON o.id=c.actor_id AND o.realm_id=c.realm_id WHERE o.id IS NULL OR c.realm_id<>'staging');",
      );
      if (Number(invalid.trim()) !== 0) throw new Error();
    }
    const result = JSON.parse(
      (
        await sql(`
SELECT json_build_object(
 'owners', (SELECT count(*) FROM admin_realms WHERE owner_id IS NOT NULL),
 'ownerId', (SELECT owner_id FROM admin_realms WHERE id='staging'),
 'invalid',
   (SELECT count(*) FROM admin_realms WHERE id<>'staging') +
   (SELECT count(*) FROM admin_operators o LEFT JOIN admin_realms r ON r.id=o.realm_id WHERE r.id IS NULL OR o.realm_id<>'staging') +
   (SELECT count(*) FROM admin_realms r LEFT JOIN admin_operators o ON o.id=r.owner_id AND o.realm_id=r.id WHERE r.owner_id IS NOT NULL AND (o.id IS NULL OR o.status<>'ACTIVE' OR o.pin_verifier IS NULL)) +
   (SELECT count(*) FROM admin_sessions s LEFT JOIN admin_operators o ON o.id=s.operator_id AND o.realm_id=s.realm_id WHERE o.id IS NULL OR s.realm_id<>'staging') +
   (SELECT count(*) FROM admin_grants g LEFT JOIN admin_operators o ON o.id=g.operator_id AND o.realm_id=g.realm_id WHERE o.id IS NULL OR g.realm_id<>'staging') +
   (SELECT count(*) FROM admin_audit_events a LEFT JOIN admin_realms r ON r.id=a.realm_id LEFT JOIN admin_operators o ON o.id=a.operator_id AND o.realm_id=a.realm_id WHERE r.id IS NULL OR a.realm_id<>'staging' OR (a.operator_id IS NOT NULL AND o.id IS NULL)) +
   (SELECT count(*) FROM admin_auth_receipts a LEFT JOIN admin_operators o ON o.id=a.operator_id LEFT JOIN admin_sessions s ON s.id=a.session_id AND s.operator_id=a.operator_id WHERE o.id IS NULL OR (a.session_id IS NOT NULL AND s.id IS NULL)),
 'disabledTriggers', (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('admin_realms'::regclass,'admin_operators'::regclass,'admin_sessions'::regclass,'admin_auth_receipts'::regclass,'admin_grants'::regclass,'admin_audit_events'::regclass) AND tgenabled<>'O'),
 'auditDeleteAllowed',has_table_privilege('hambazi_admin_runtime','admin_audit_events','DELETE'),
 'ownerBindingUpdateAllowed',has_column_privilege('hambazi_admin_runtime','admin_realms','owner_id','UPDATE'),
 'rows',json_build_array((SELECT count(*) FROM admin_realms),(SELECT count(*) FROM admin_operators),(SELECT count(*) FROM admin_sessions),(SELECT count(*) FROM admin_auth_receipts),(SELECT count(*) FROM admin_grants),(SELECT count(*) FROM admin_audit_events))
);
`)
      ).trim(),
    ) as {
      owners: number;
      ownerId: string | null;
      invalid: number;
      disabledTriggers: number;
      auditDeleteAllowed: boolean;
      ownerBindingUpdateAllowed: boolean;
      rows: number[];
    };
    if (
      result.invalid ||
      result.disabledTriggers ||
      result.auditDeleteAllowed ||
      result.ownerBindingUpdateAllowed ||
      result.owners > 1 ||
      result.ownerId !== (capsule.checkpoint?.ownerId ?? null) ||
      capsule.checkpoint?.pending
    )
      throw new Error();
    if (capsule.scope === "staging-admin-nine-tables") {
      const counts: number[] = JSON.parse(
        (
          await sql(
            "SELECT json_build_array((SELECT count(*) FROM admin_roles),(SELECT count(*) FROM admin_operator_roles),(SELECT count(*) FROM admin_operations));",
          )
        ).trim(),
      );
      result.rows.push(...counts);
    }
    outcome = { ownerPresent: result.owners === 1, tableRows: result.rows };
  } catch {
    failed = true;
  } finally {
    // Clean only this invocation's unique, unshared, networkless container.
    try {
      await execute("docker", [...args, "rm", "--force", name], {
        env: local,
        timeout: 10000,
        maxBuffer: 65536,
      });
    } catch {
      try {
        const exists = await execute(
          "docker",
          [
            ...args,
            "container",
            "ls",
            "--all",
            "--filter",
            "name=^/" + name + "$",
            "--format",
            "{{.Names}}",
          ],
          { env: local, timeout: 10000, maxBuffer: 65536 },
        );
        cleanupFailed = !!exists.stdout.trim();
      } catch {
        cleanupFailed = true;
      }
    } finally {
      for (const event of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(event, stop);
    }
  }
  if (cleanupFailed) throw new Error("ADMIN_RESTORE_CLEANUP_REQUIRED");
  if (failed || stopped || !outcome) throw new Error("ADMIN_RESTORE_REHEARSAL_DENIED");
  return outcome;
}

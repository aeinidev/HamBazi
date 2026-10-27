import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createDatabase } from "@hambazi/database";
import {
  createAdminCrypto,
  createAdminModule,
  createAdminProvisioningModule,
} from "../../src/admin/index.js";
import {
  openOwnerBackup,
  ownerDumpArguments,
  sealOwnerBackup,
} from "../../src/composition/admin-owner-backup.js";
import { stagingAuthority } from "../../src/composition/admin-owner-state.js";
import { rehearseOwnerRestore } from "../../src/composition/admin-owner-restore.js";

if (
  process.env.TEST_ADMIN_CONFIRM !== "owned-disposable-admin" ||
  !/^hambazi-admin-test-[0-9a-f]+$/.test(process.env.TEST_ADMIN_CONTAINER ?? "") ||
  !process.env.TEST_ADMIN_OWNER_SOURCE_URL ||
  !process.env.TEST_ADMIN_OWNER_RESTORE_URL
)
  throw new Error("Use test:admin:local only");
const sourceUrl = new URL(process.env.TEST_ADMIN_OWNER_SOURCE_URL),
  restoreUrl = new URL(process.env.TEST_ADMIN_OWNER_RESTORE_URL);
if (
  sourceUrl.hostname !== "127.0.0.1" ||
  restoreUrl.hostname !== "127.0.0.1" ||
  sourceUrl.pathname !== "/hambazi_owner_source" ||
  restoreUrl.pathname !== "/hambazi_owner_restore"
)
  throw new Error("Owned databases only");
const require = createRequire(
  new URL("../../../../packages/database/package.json", import.meta.url),
);
const { Client } = require("pg") as {
  Client: new (options: { connectionString: string }) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
};
const source = new Client({ connectionString: sourceUrl.toString() }),
  restored = new Client({ connectionString: restoreUrl.toString() });
const connections: ReturnType<typeof createDatabase>[] = [];
const roleUrl = (url: URL, role: string) => {
  const value = new URL(url);
  value.username = role;
  return value.toString();
};
const db = (url: URL, role: string) => {
  const connection = createDatabase({
    databaseUrl: { reveal: () => roleUrl(url, role) },
    poolMax: 2,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    transactionMaxWaitMs: 5000,
    transactionTimeoutMs: 5000,
  });
  connections.push(connection);
  return connection;
};
const clock = { nowMs: () => Date.now() };
const crypto = createAdminCrypto({
  signingKey: { reveal: () => Buffer.alloc(32, 11).toString("base64url") },
  pinPepper: { reveal: () => Buffer.alloc(32, 22).toString("base64url") },
  commandKey: { reveal: () => Buffer.alloc(32, 33).toString("base64url") },
  issuer: "urn:hambazi:synthetic:admin",
  audience: "urn:hambazi:synthetic:console",
  realmId: "staging",
  clock,
  memoryCost: 19456,
  timeCost: 2,
});
const ownerPassword = "SyntheticOwnerDrillPassword123",
  ownerPin = "012345",
  newPin = "654321";
let ownerId: string, fullToken: string, pendingToken: string;
let service: ReturnType<typeof createAdminModule>["service"];
const runtime = db(sourceUrl, "hambazi_admin_runtime"),
  bootstrap = db(sourceUrl, "hambazi_admin_bootstrap"),
  recovery = db(restoreUrl, "hambazi_admin_recovery"),
  restoredRuntime = db(restoreUrl, "hambazi_admin_runtime");
async function privateRun(database: typeof recovery, request: Record<string, unknown>) {
  const authority = stagingAuthority(
    {
      commandId: String(request.commandId),
      username: String(request.username),
      reasonCode: String(request.reasonCode),
      digest: crypto.digest(JSON.stringify(request)),
    },
    clock.nowMs,
  );
  return createAdminProvisioningModule(database, {
    crypto,
    realmId: "staging",
    clock,
    newId: randomUUID,
    recoveryPasswordRequired: true,
    verifyAuthority: authority.verify,
  }).run(request, authority.proof);
}
async function makeService(database: typeof runtime) {
  return createAdminModule(database, "staging", {
    crypto,
    clock,
    newId: randomUUID,
    dummyPasswordVerifier: await crypto.hash("SyntheticUnknownPassword", "password"),
    policy: {
      realmId: "staging",
      environment: "staging",
      sessionSeconds: 900,
      idleSeconds: 300,
      pendingSeconds: 120,
      maxCryptoInFlight: 2,
    },
  }).service;
}
const login = (s = service) =>
  s.login({
    schemaVersion: 1,
    commandId: randomUUID(),
    username: "owner_drill",
    password: ownerPassword,
  });
const docker = [
  "--host",
  "unix:///var/run/docker.sock",
  "exec",
  "--interactive",
  "--env",
  "PGPASSWORD",
  process.env.TEST_ADMIN_CONTAINER!,
];
const childEnv = {
  ...process.env,
  PGPASSWORD: decodeURIComponent(sourceUrl.password),
  DOCKER_CONTEXT: "",
  DOCKER_HOST: "unix:///var/run/docker.sock",
  DOCKER_TLS_VERIFY: "",
  DOCKER_CERT_PATH: "",
};
beforeAll(async () => {
  await Promise.all([source.connect(), restored.connect(), ...connections.map((c) => c.connect())]);
  service = await makeService(runtime);
});
afterAll(async () => {
  await Promise.allSettled([
    source.end(),
    restored.end(),
    ...connections.map((c) => c.disconnect()),
  ]);
});

describe("owned PostgreSQL Staging owner restore rehearsal", () => {
  it("rehearses the empty pre-enrollment backup through the real offline CLI and private PTY", async () => {
    await source.query("INSERT INTO admin_realms(id) VALUES('staging')");
    const dumped = await promisify(execFile)(
      "docker",
      [
        ...docker,
        "pg_dump",
        "--host=127.0.0.1",
        "--username=hambazi_admin_recovery",
        "--dbname=hambazi_owner_source",
        ...ownerDumpArguments.slice(0, -3),
      ],
      { env: childEnv, encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: 20000 },
    );
    const encrypted = sealOwnerBackup(
      {
        schemaVersion: 1,
        scope: "staging-admin-six-tables",
        realm: "staging",
        createdAtUTC: new Date().toISOString(),
        sourceRevision: "a".repeat(64),
        schemaTag: "admin-local-identity+password-rotation-v1",
        runtimeEnvironment: "SYNTHETIC_KEYS=fixture-only",
        operatorEnvironment: "SYNTHETIC_URLS=fixture-only",
        checkpoint: null,
        dumpBase64: dumped.stdout.toString("base64"),
      },
      "SyntheticIndependentBackupSecret123",
    );
    const directory = await mkdtemp(join(tmpdir(), "hambazi-owner-cli-fixture-"));
    const path = join(directory, "fixture.hba");
    try {
      await writeFile(path, encrypted, { mode: 0o600 });
      await promisify(execFile)(
        "python3",
        [
          fileURLToPath(new URL("../admin/restore-cli-tty.py", import.meta.url)),
          fileURLToPath(
            new URL("../../dist/composition/admin-owner-restore-cli.js", import.meta.url),
          ),
          path,
        ],
        { timeout: 80000, maxBuffer: 65536 },
      );
      const receipt = JSON.parse(await readFile(path + ".restore.json", "utf8"));
      expect(receipt.snapshotSHA256).toBe(createHash("sha256").update(encrypted).digest("hex"));
      expect(receipt.sourceRevision).toBe("a".repeat(64));
      expect(receipt.restored).toBe(true);
      expect(receipt.offServerCopyVerified).toBe(true);
      expect(
        (await source.query("SELECT count(*)::int AS count FROM admin_operators")).rows[0]!.count,
      ).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 90000);
  it("bootstraps exactly once, rejects missing SSH authority, and persists the three-PIN lock", async () => {
    const request = {
      schemaVersion: 1,
      commandId: randomUUID(),
      username: "owner_drill",
      password: ownerPassword,
      pin: ownerPin,
      confirmed: true,
      reasonCode: "INITIAL_OWNER_ENROLLMENT",
    };
    const denied = createAdminProvisioningModule(bootstrap, {
      crypto,
      realmId: "staging",
      clock,
      newId: randomUUID,
      recoveryPasswordRequired: true,
      verifyAuthority: async () => false,
    });
    await expect(denied.run(request, {})).rejects.toThrow("FORBIDDEN");
    const results = await Promise.allSettled([
      privateRun(bootstrap, request),
      privateRun(bootstrap, { ...request, commandId: randomUUID() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    ownerId = String(
      (await source.query("SELECT owner_id FROM admin_realms WHERE id='staging'")).rows[0]!
        .owner_id,
    );
    const pending = await login();
    pendingToken = (await login()).token;
    fullToken = (
      await service.pin(pending.token, { schemaVersion: 1, commandId: randomUUID(), pin: ownerPin })
    ).token;
    const lock = await login();
    for (let i = 0; i < 3; i++)
      await expect(
        service.pin(lock.token, { schemaVersion: 1, commandId: randomUUID(), pin: "999999" }),
      ).rejects.toThrow();
    const row = (
      await source.query("SELECT pin_failures,locked_at FROM admin_operators WHERE id=$1", [
        ownerId,
      ])
    ).rows[0]!;
    expect(row.pin_failures).toBe(3);
    expect(row.locked_at).not.toBeNull();
    await expect(login()).rejects.toThrow();
  });
  it("encrypts an actual nine-table pg_dump and restores only into the separate owned database", async () => {
    const roleId = randomUUID();
    await source.query(
      "INSERT INTO admin_roles(id,realm_id,name,version,grants_jsonb) VALUES($1,'staging','Synthetic backup role',1,'[]')",
      [roleId],
    );
    await source.query(
      "INSERT INTO admin_operator_roles(operator_id,role_id,realm_id) VALUES($1,$2,'staging')",
      [ownerId, roleId],
    );
    const dumped = await promisify(execFile)(
      "docker",
      [
        ...docker,
        "pg_dump",
        "--host=127.0.0.1",
        "--username=hambazi_admin_recovery",
        "--dbname=hambazi_owner_source",
        ...ownerDumpArguments,
      ],
      { env: childEnv, encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: 20000 },
    );
    expect(dumped.stdout.subarray(0, 5).toString()).toBe("PGDMP");
    const sealed = sealOwnerBackup(
      {
        schemaVersion: 1,
        scope: "staging-admin-nine-tables",
        realm: "staging",
        createdAtUTC: new Date().toISOString(),
        sourceRevision: "a".repeat(64),
        schemaTag: "admin-local-identity+access-management-v2",
        runtimeEnvironment: "SYNTHETIC_KEYS=fixture-only",
        operatorEnvironment: "SYNTHETIC_URLS=fixture-only",
        checkpoint: {
          schemaVersion: 1,
          profile: "staging-ssh-root-v1",
          realm: "staging",
          ownerId,
          pending: null,
        },
        dumpBase64: dumped.stdout.toString("base64"),
      },
      "SyntheticIndependentBackupSecret123",
    );
    const opened = openOwnerBackup(sealed, "SyntheticIndependentBackupSecret123");
    const offline = await rehearseOwnerRestore(opened);
    expect(offline.ownerPresent).toBe(true);
    expect(offline.tableRows).toHaveLength(9);
    expect(offline.tableRows.slice(6)).toEqual([1, 1, 0]);
    const before = await source.query(
      "SELECT id,pin_failures,locked_at,session_epoch,password_verifier,pin_verifier FROM admin_operators",
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "docker",
        [
          ...docker,
          "pg_restore",
          "--host=127.0.0.1",
          "--username=postgres",
          "--dbname=hambazi_owner_restore",
          "--data-only",
          "--disable-triggers",
          "--single-transaction",
          "--exit-on-error",
          "--no-owner",
          "--no-acl",
        ],
        { env: childEnv, stdio: ["pipe", "ignore", "pipe"] },
      );
      child.stderr.resume();
      child.on("error", () => reject(new Error("ADMIN_TEST_RESTORE_FAILED")));
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error("ADMIN_TEST_RESTORE_FAILED")),
      );
      child.stdin.on("error", () => reject(new Error("ADMIN_TEST_RESTORE_FAILED")));
      child.stdin.end(Buffer.from(opened.dumpBase64, "base64"));
    });
    expect(
      (
        await restored.query(
          "SELECT id,pin_failures,locked_at,session_epoch,password_verifier,pin_verifier FROM admin_operators",
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await source.query(
          "SELECT id,pin_failures,locked_at,session_epoch,password_verifier,pin_verifier FROM admin_operators",
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await restored.query(
          "SELECT count(*)::int AS count FROM admin_realms r JOIN admin_operators o ON r.owner_id=o.id AND r.id=o.realm_id",
        )
      ).rows[0]!.count,
    ).toBe(1);
    expect(
      (await restored.query("SELECT count(*)::int AS count FROM admin_sessions")).rows[0]!.count,
    ).toBe(
      (await source.query("SELECT count(*)::int AS count FROM admin_sessions")).rows[0]!.count,
    );
    expect(
      (await restored.query("SELECT event,command_id FROM admin_audit_events ORDER BY id")).rows,
    ).toEqual(
      (await source.query("SELECT event,command_id FROM admin_audit_events ORDER BY id")).rows,
    );
    await expect(restored.query("DELETE FROM admin_audit_events")).rejects.toBeDefined();
    await expect(
      restored.query("UPDATE admin_realms SET owner_id=NULL WHERE id='staging'"),
    ).rejects.toBeDefined();
    await expect(
      restored.query("UPDATE admin_operators SET locked_at=NULL,pin_failures=0 WHERE id=$1", [
        ownerId,
      ]),
    ).rejects.toBeDefined();
  }, 60000);
  it("recovers the same restored owner only with its password, preserves hash, audits atomically and revokes old sessions", async () => {
    const s = await makeService(restoredRuntime);
    const request = {
      schemaVersion: 1,
      commandId: randomUUID(),
      username: "owner_drill",
      password: ownerPassword,
      pin: newPin,
      confirmed: true,
      reasonCode: "OWNER_PIN_RECOVERY",
    };
    const before = (await restored.query("SELECT * FROM admin_operators WHERE id=$1", [ownerId]))
      .rows[0]!;
    await expect(
      privateRun(recovery, { ...request, password: "WrongPassword123" }),
    ).rejects.toThrow("FORBIDDEN");
    expect(
      (await restored.query("SELECT * FROM admin_operators WHERE id=$1", [ownerId])).rows[0],
    ).toEqual(before);
    await restored.query(
      "CREATE FUNCTION admin_owner_drill_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='OWNER_RECOVERED' THEN RAISE EXCEPTION 'Synthetic audit outage'; END IF; RETURN NEW; END; $$; CREATE TRIGGER admin_owner_drill_audit_failure BEFORE INSERT ON admin_audit_events FOR EACH ROW EXECUTE FUNCTION admin_owner_drill_audit_failure();",
    );
    try {
      await expect(privateRun(recovery, request)).rejects.toThrow();
    } finally {
      await restored.query(
        "DROP TRIGGER admin_owner_drill_audit_failure ON admin_audit_events; DROP FUNCTION admin_owner_drill_audit_failure();",
      );
    }
    expect(
      (await restored.query("SELECT * FROM admin_operators WHERE id=$1", [ownerId])).rows[0],
    ).toEqual(before);
    expect((await privateRun(recovery, request)).operatorId).toBe(ownerId);
    const after = (await restored.query("SELECT * FROM admin_operators WHERE id=$1", [ownerId]))
      .rows[0]!;
    expect(after.password_verifier).toBe(before.password_verifier);
    expect(after.pin_failures).toBe(0);
    expect(after.locked_at).toBeNull();
    expect(after.session_epoch).toBe(Number(before.session_epoch) + 1);
    await expect(s.authenticate(fullToken)).rejects.toThrow();
    await expect(
      s.pin(pendingToken, { schemaVersion: 1, commandId: randomUUID(), pin: ownerPin }),
    ).rejects.toThrow();
    const pending = await login(s);
    const full = await s.pin(pending.token, {
      schemaVersion: 1,
      commandId: randomUUID(),
      pin: newPin,
    });
    expect((await s.authenticate(full.token)).principal.isOwner).toBe(true);
    expect(
      (
        await restored.query(
          "SELECT count(*)::int AS count FROM admin_audit_events WHERE event='OWNER_RECOVERED'",
        )
      ).rows[0]!.count,
    ).toBe(1);
    // Production-like grants are restored by migrations/grants, not by giving the app superuser.
    const least = new Client({ connectionString: roleUrl(restoreUrl, "hambazi_admin_runtime") });
    await least.connect();
    try {
      await expect(least.query("DELETE FROM admin_audit_events")).rejects.toBeDefined();
      await expect(least.query("SELECT state_jsonb FROM matches")).rejects.toBeDefined();
      await expect(
        least.query("UPDATE admin_operators SET username='other' WHERE id=$1", [ownerId]),
      ).rejects.toBeDefined();
    } finally {
      await least.end();
    }
  });
});

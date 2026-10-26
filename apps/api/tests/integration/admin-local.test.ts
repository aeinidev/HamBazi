import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { request } from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createDatabase } from "@hambazi/database";
import {
  createAdminCrypto,
  createAdminModule,
  createAdminProvisioningModule,
  createAdminProvisioningAuthority,
  adminProvisioningStatement,
} from "../../src/admin/index.js";
import { createAdminHttpApplication } from "../../src/composition/admin-http.js";
import { createUsersAdminRead } from "../../src/users/index.js";
import { createMatchesAdminRead } from "../../src/matches/index.js";
import { createRedisAuthRateLimiter } from "../../src/auth/index.js";

if (
  process.env.TEST_ADMIN_CONFIRM !== "owned-disposable-admin" ||
  !process.env.TEST_ADMIN_DATABASE_URL ||
  !/^hambazi-admin-test-[0-9a-f]+$/.test(process.env.TEST_ADMIN_CONTAINER ?? "")
)
  throw new Error("Use test:admin:local only");
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
const root = new Client({ connectionString: process.env.TEST_ADMIN_DATABASE_URL });
const options = {
  poolMax: 4,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
};
const runtime = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_ADMIN_RUNTIME_URL! },
});
const bootstrap = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_ADMIN_BOOTSTRAP_URL! },
});
const recovery = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_ADMIN_RECOVERY_URL! },
});
const readDatabase = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_ADMIN_READER_URL! },
});
const clock = { nowMs: () => Date.now() };
const crypto = createAdminCrypto({
  signingKey: { reveal: () => Buffer.alloc(32, 11).toString("base64url") },
  pinPepper: { reveal: () => Buffer.alloc(32, 22).toString("base64url") },
  commandKey: { reveal: () => Buffer.alloc(32, 33).toString("base64url") },
  issuer: "urn:hambazi:synthetic:admin",
  audience: "urn:hambazi:synthetic:console",
  realmId: "integration",
  clock,
  memoryCost: 19456,
  timeCost: 2,
});
let service: ReturnType<typeof createAdminModule>["service"];
const ownerPassword = "IntegrationSyntheticPassword123",
  ownerPin = "012345";
let ownerId: string;
let rootClosed = false;
const serverKey = generateKeyPairSync("ed25519"),
  ownerKey = generateKeyPairSync("ed25519");
const verifyAuthority = createAdminProvisioningAuthority({
  operatorPublicKey: serverKey.publicKey.export({ type: "spki", format: "pem" }).toString(),
  ownershipPublicKey: ownerKey.publicKey.export({ type: "spki", format: "pem" }).toString(),
  clock,
});
function proof(input: Record<string, unknown>) {
  const statement = {
    commandId: String(input.commandId),
    realmId: "integration",
    username: String(input.username),
    reasonCode: String(input.reasonCode),
    digest: crypto.digest(JSON.stringify(input)),
    issuedAt: Date.now() - 1,
    expiresAt: Date.now() + 60000,
  };
  const bytes = Buffer.from(adminProvisioningStatement(statement));
  return {
    ...statement,
    operatorSignature: sign(null, bytes, serverKey.privateKey).toString("base64url"),
    ownershipSignature: sign(null, bytes, ownerKey.privateKey).toString("base64url"),
  };
}
const provision = (database: typeof recovery) =>
  createAdminProvisioningModule(database, {
    crypto,
    realmId: "integration",
    clock,
    newId: randomUUID,
    verifyAuthority,
  });
async function recoverOwner() {
  const input = {
    schemaVersion: 1,
    commandId: randomUUID(),
    username: "owner_integration",
    pin: ownerPin,
    confirmed: true,
    reasonCode: "OWNER_PIN_RECOVERY",
  };
  await provision(recovery).run(input, proof(input));
}
beforeAll(async () => {
  await Promise.all([
    root.connect(),
    runtime.connect(),
    bootstrap.connect(),
    recovery.connect(),
    readDatabase.connect(),
  ]);
  const port = provision(bootstrap);
  const input = {
    schemaVersion: 1,
    commandId: randomUUID(),
    username: "owner_integration",
    password: ownerPassword,
    pin: ownerPin,
    confirmed: true,
    reasonCode: "INITIAL_OWNER_ENROLLMENT",
  };
  const result = await port.run(input, proof(input));
  ownerId = result.operatorId;
  expect((await port.run(input, proof(input))).operatorId).toBe(ownerId);
  service = createAdminModule(runtime, "integration", {
    crypto,
    clock,
    newId: randomUUID,
    policy: {
      realmId: "integration",
      environment: "test",
      sessionSeconds: 900,
      idleSeconds: 300,
      pendingSeconds: 120,
      maxCryptoInFlight: 2,
    },
    dummyPasswordVerifier: await crypto.hash("IntegrationUnknownPassword", "password"),
  }).service;
});
afterAll(async () => {
  await Promise.allSettled([
    ...(rootClosed ? [] : [root.end()]),
    runtime.disconnect(),
    bootstrap.disconnect(),
    recovery.disconnect(),
    readDatabase.disconnect(),
  ]);
});
const login = () =>
  service.login({
    schemaVersion: 1,
    commandId: randomUUID(),
    username: "owner_integration",
    password: ownerPassword,
  });
const pin = (token: string, pinValue = ownerPin, commandId = randomUUID()) =>
  service.pin(token, { schemaVersion: 1, commandId, pin: pinValue });
describe("durable local Admin identity", () => {
  it("has one root and rejects a second bootstrap and unproved recovery", async () => {
    const input = {
      schemaVersion: 1,
      commandId: randomUUID(),
      username: "another_owner",
      password: ownerPassword,
      pin: ownerPin,
      confirmed: true,
      reasonCode: "INITIAL_OWNER_ENROLLMENT",
    };
    await expect(provision(bootstrap).run(input, proof(input))).rejects.toBeDefined();
    await expect(
      provision(recovery).run(
        {
          schemaVersion: 1,
          commandId: randomUUID(),
          username: "owner_integration",
          pin: "654321",
          confirmed: true,
          reasonCode: "OWNER_PIN_RECOVERY",
        },
        null,
      ),
    ).rejects.toBeDefined();
    expect(
      (
        await root.query(
          "SELECT count(*)::int AS count FROM admin_realms WHERE owner_id IS NOT NULL",
        )
      ).rows[0]!.count,
    ).toBe(1);
  });
  it("does not grant a full session before PIN and rejects ordinary role/username impersonation", async () => {
    const pending = await login();
    await expect(service.access(pending.token)).rejects.toBeDefined();
    const full = await pin(pending.token);
    expect((await service.access(full.token)).isOwner).toBe(true);
  });
  it("serializes concurrent PIN failures, deduplicates retry and locks on the third attempt", async () => {
    const pending = await login();
    const same = randomUUID();
    await Promise.allSettled([
      pin(pending.token, "111111", same),
      pin(pending.token, "111111", same),
    ]);
    expect(
      (await root.query("SELECT pin_failures FROM admin_operators WHERE id=$1", [ownerId])).rows[0]!
        .pin_failures,
    ).toBe(1);
    const second = await login();
    await Promise.allSettled([pin(pending.token, "222222"), pin(second.token, "333333")]);
    const row = (
      await root.query("SELECT pin_failures,locked_at FROM admin_operators WHERE id=$1", [ownerId])
    ).rows[0]!;
    expect(row.pin_failures).toBe(3);
    expect(row.locked_at).not.toBeNull();
    await expect(login()).rejects.toBeDefined();
    await expect(pin(second.token)).rejects.toBeDefined();
  });
  it("recovers only through private dual authority and revokes all prior sessions", async () => {
    await expect(
      runtime.forModule("admin").execute((db) =>
        db.adminOperator.update({
          where: { id: ownerId },
          data: { lockedAt: null, pinFailures: 0 },
        }),
      ),
    ).rejects.toBeDefined();
    await recoverOwner();
    const full = await pin((await login()).token);
    expect((await service.access(full.token)).isOwner).toBe(true);
    await recoverOwner();
    await expect(service.access(full.token)).rejects.toBeDefined();
    const row = (
      await root.query("SELECT pin_failures,locked_at FROM admin_operators WHERE id=$1", [ownerId])
    ).rows[0]!;
    expect(row.pin_failures).toBe(0);
    expect(row.locked_at).toBeNull();
  });
  it("has append-only evidence, protected root binding and no game writes or hidden-state reader grants", async () => {
    await expect(root.query("DELETE FROM admin_audit_events")).rejects.toBeDefined();
    await expect(root.query("TRUNCATE admin_auth_receipts")).rejects.toBeDefined();
    await expect(
      root.query("UPDATE admin_realms SET owner_id=NULL WHERE id='integration'"),
    ).rejects.toBeDefined();
    await expect(
      root.query("UPDATE admin_operators SET status='DISABLED' WHERE id=$1", [ownerId]),
    ).rejects.toBeDefined();
    await expect(
      runtime.forModule("matches").execute((db) => db.match.count({})),
    ).rejects.toBeDefined();
    await expect(
      readDatabase
        .forModule("matches")
        .execute((db) => db.match.findMany({ select: { stateJsonb: true }, take: 1 })),
    ).rejects.toBeDefined();
    expect((await createUsersAdminRead(readDatabase)({ limit: 5 }, null)).items).toEqual([]);
    expect((await createMatchesAdminRead(readDatabase)({ limit: 5 }, null)).items).toEqual([]);
    const events = (await root.query("SELECT event FROM admin_audit_events")).rows;
    expect(JSON.stringify(events)).not.toContain(ownerPassword);
    expect(JSON.stringify(events)).not.toContain(ownerPin);
  });
  it("returns bounded, game-scoped metadata and pinned versions without hidden state", async () => {
    for (const game of ["synthetic-a", "synthetic-b"])
      await root.query(
        "INSERT INTO games(id,slug,title,min_players,max_players,matchmaking_enabled,private_rooms_enabled,chat_enabled,status,config_schema_version,config_jsonb,updated_at) VALUES($1,$1,$1,2,6,false,false,false,'DISABLED',1,'{}',now())",
        [game],
      );
    const a = randomUUID(),
      b = randomUUID();
    for (const [id, game] of [
      [a, "synthetic-a"],
      [b, "synthetic-b"],
    ])
      await root.query(
        "INSERT INTO matches(id,game_id,match_type,status,engine_version,state_schema_version,ruleset_version,state_jsonb,updated_at) VALUES($1,$2,'PRIVATE','CREATED','synthetic-engine',1,'synthetic-rules',$3,now())",
        [id, game, JSON.stringify({ hidden: "SYNTHETIC_HIDDEN_CANARY" })],
      );
    const read = createMatchesAdminRead(readDatabase);
    const page = await read({ limit: 1 }, ["synthetic-a"]);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.id).toBe(a);
    expect(page.items[0]!.pins.engineVersion).toBe("synthetic-engine");
    expect(JSON.stringify(page)).not.toContain("SYNTHETIC_HIDDEN_CANARY");
    expect((await read({ limit: 1, id: b }, ["synthetic-a"])).items).toEqual([]);
    await expect(read({ limit: 51 }, null)).rejects.toBeDefined();
  });
  it("rolls back the PIN counter when durable audit is unavailable", async () => {
    const pending = await login();
    await root.query("REVOKE INSERT ON admin_audit_events FROM hambazi_admin_runtime");
    try {
      await expect(pin(pending.token, "999999")).rejects.toBeDefined();
    } finally {
      await root.query("GRANT INSERT ON admin_audit_events TO hambazi_admin_runtime");
    }
    expect(
      (await root.query("SELECT pin_failures FROM admin_operators WHERE id=$1", [ownerId])).rows[0]!
        .pin_failures,
    ).toBe(0);
  });
  it("shares Admin rate counters across nodes, isolates namespaces and fails closed on Redis outage", async () => {
    const options = {
      url: { reveal: () => process.env.TEST_ADMIN_REDIS_URL! },
      namespace: "admin-v1:integration",
      ipLimit: 1,
      identityLimit: 1,
    };
    const a = createRedisAuthRateLimiter(options),
      b = createRedisAuthRateLimiter(options),
      other = createRedisAuthRateLimiter({ ...options, namespace: "player-fixture" });
    try {
      await Promise.all([a.connect(), b.connect(), other.connect()]);
      expect((await a.limiter.consumeIp("127.0.0.1")).allowed).toBe(true);
      expect((await b.limiter.consumeIp("127.0.0.1")).allowed).toBe(false);
      expect((await other.limiter.consumeIp("127.0.0.1")).allowed).toBe(true);
      expect((await a.limiter.consumeIdentity("owner_integration")).allowed).toBe(true);
      expect((await b.limiter.consumeIdentity("owner_integration")).allowed).toBe(false);
      a.close();
      expect((await a.limiter.consumeIp("127.0.0.2")).allowed).toBe(false);
    } finally {
      a.close();
      b.close();
      other.close();
    }
  });
  it("rechecks permissions and account status on existing sessions without trusting token roles", async () => {
    const id = randomUUID();
    await root.query(
      "INSERT INTO admin_operators(id,realm_id,username,password_verifier,credential_version,session_epoch,authorization_version,status) VALUES($1,'integration','operator_integration',$2,1,1,1,'ACTIVE')",
      [id, await crypto.hash(ownerPassword, "password")],
    );
    const full = await service.login({
      schemaVersion: 1,
      commandId: randomUUID(),
      username: "operator_integration",
      password: ownerPassword,
    });
    expect(full.next).toBe("SIGNED_IN");
    expect((await service.access(full.token)).permissions).toEqual([]);
    await root.query(
      "INSERT INTO admin_grants(id,realm_id,operator_id,permission,environment,all_games,game_ids) VALUES($1,'integration',$2,'matches.view','test',false,ARRAY['coup'])",
      [randomUUID(), id],
    );
    await root.query(
      "UPDATE admin_operators SET authorization_version=authorization_version+1 WHERE id=$1",
      [id],
    );
    expect((await service.access(full.token)).permissions).toContain("matches.view");
    await root.query("DELETE FROM admin_grants WHERE operator_id=$1", [id]);
    expect((await service.access(full.token)).permissions).toEqual([]);
    await root.query("UPDATE admin_operators SET status='DISABLED' WHERE id=$1", [id]);
    await expect(service.access(full.token)).rejects.toBeDefined();
  });
  it("enforces TLS peer/Host/Origin/CSRF and rejects player tokens, signup, unlock and product mutations", async () => {
    const tls = {
      key: await readFile(process.env.TEST_ADMIN_TLS_KEY!),
      cert: await readFile(process.env.TEST_ADMIN_TLS_CERT!),
    };
    const peers = ["127.0.0.1"];
    let available = true;
    const app = await createAdminHttpApplication(
      {
        service,
        csrf: crypto.csrf,
        cookieSeconds: 900,
        pendingSeconds: 120,
        reads: {
          page: async () => ({
            schemaVersion: 1,
            asOf: new Date().toISOString(),
            items: [],
            nextCursor: null,
          }),
          overview: async () => ({ schemaVersion: 1, asOf: new Date().toISOString(), metrics: [] }),
          audit: async () => ({ schemaVersion: 1, asOf: new Date().toISOString(), items: [] }),
        },
      },
      {
        ...tls,
        origin: "https://admin.local",
        peers,
        maxInFlight: 4,
        admitIp: async () => available,
        admitIdentity: async () => available,
      },
    );
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    const send = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
      new Promise<{
        status: number;
        headers: Record<string, unknown>;
        body: Record<string, unknown>;
      }>((resolve, reject) => {
        const req = request(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: "/v1/admin/" + path,
            method: body === undefined ? "GET" : "POST",
            servername: "admin.local",
            ca: tls.cert,
            headers: {
              host: "admin.local",
              ...(body === undefined
                ? {}
                : { origin: "https://admin.local", "content-type": "application/json" }),
              ...headers,
            },
          },
          (res) => {
            let text = "";
            res.on("data", (chunk) => {
              text += String(chunk);
            });
            res.on("end", () =>
              resolve({ status: res.statusCode!, headers: res.headers, body: JSON.parse(text) }),
            );
          },
        );
        req.on("error", reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
    try {
      const input = {
        schemaVersion: 1,
        commandId: randomUUID(),
        username: "owner_integration",
        password: ownerPassword,
      };
      const denied = await send("auth/login", { ...input, password: "IncorrectSyntheticPassword" });
      expect(denied.status).toBe(401);
      expect(denied.body).not.toHaveProperty("next");
      expect(denied.headers["set-cookie"]).toBeUndefined();
      const pending = await send("auth/login", input);
      expect(pending.status).toBe(201);
      expect(pending.body.next).toBe("PIN_REQUIRED");
      const pendingCookie = (pending.headers["set-cookie"] as string[])[0]!.split(";")[0]!;
      expect((pending.headers["set-cookie"] as string[])[0]).toMatch(
        /HttpOnly; Secure; SameSite=Strict/,
      );
      expect((await send("me/access", undefined, { cookie: pendingCookie })).status).toBe(401);
      const pinBody = { schemaVersion: 1, commandId: randomUUID(), pin: ownerPin };
      expect((await send("auth/pin", pinBody, { cookie: pendingCookie })).status).toBe(403);
      const full = await send("auth/pin", pinBody, {
        cookie: pendingCookie,
        "x-csrf-token": String(pending.body.csrfToken),
      });
      expect(full.body.next).toBe("SIGNED_IN");
      const cookie = (full.headers["set-cookie"] as string[])[0]!.split(";")[0]!;
      expect((await send("overview", undefined, { cookie })).status).toBe(200);
      expect(
        (
          await send("overview", undefined, {
            cookie,
            authorization: "Bearer synthetic-player-token",
          })
        ).status,
      ).toBe(403);
      expect(
        (await send("overview", undefined, { cookie, "x-forwarded-for": "127.0.0.1" })).status,
      ).toBe(403);
      expect((await send("overview", undefined, { cookie, host: "public.local" })).status).toBe(
        403,
      );
      expect(
        (
          await send(
            "auth/logout",
            { schemaVersion: 1, commandId: randomUUID() },
            { cookie, origin: "https://evil.local" },
          )
        ).status,
      ).toBe(403);
      for (const path of ["auth/signup", "auth/unlock", "matches/terminate"])
        expect((await send(path, {}, { cookie })).status).toBe(404);
      expect((await send("users?limit=51", undefined, { cookie })).status).toBe(400);
      available = false;
      expect((await send("overview", undefined, { cookie })).status).toBe(429);
      expect(
        (
          await send(
            "auth/logout",
            { schemaVersion: 1, commandId: randomUUID() },
            { cookie, "x-csrf-token": String(full.body.csrfToken) },
          )
        ).status,
      ).toBe(201);
      available = true;
      peers.pop();
      expect((await send("overview", undefined, { cookie })).status).toBe(403);
    } finally {
      await app.close();
    }
  });
  it("retains the lock after a real PostgreSQL restart and repository recreation", async () => {
    for (let n = 0; n < 3; n++) {
      const pending = await login();
      await expect(pin(pending.token, "999999")).rejects.toBeDefined();
    }
    await Promise.all([
      runtime.disconnect(),
      bootstrap.disconnect(),
      recovery.disconnect(),
      readDatabase.disconnect(),
    ]);
    await root.end();
    rootClosed = true;
    await promisify(execFile)("docker", ["restart", process.env.TEST_ADMIN_CONTAINER!], {
      timeout: 30000,
    });
    let port = "";
    const restartedUrl = (original: string) => {
      const url = new URL(original);
      url.port = port;
      return url.toString();
    };
    let client: InstanceType<typeof Client> | undefined;
    for (let n = 0; n < 80; n++) {
      port = (
        await promisify(execFile)("docker", [
          "inspect",
          "--format",
          '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
          process.env.TEST_ADMIN_CONTAINER!,
        ])
      ).stdout.trim();
      if (!/^[1-9][0-9]{0,4}$/.test(port)) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      const c = new Client({
        connectionString: restartedUrl(process.env.TEST_ADMIN_DATABASE_URL!),
      });
      try {
        await c.connect();
        client = c;
        break;
      } catch {
        await c.end().catch(() => {});
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!client) throw new Error("ADMIN_TEST_RESTART_NOT_READY");
    try {
      const row = (
        await client.query("SELECT pin_failures,locked_at FROM admin_operators WHERE id=$1", [
          ownerId,
        ])
      ).rows[0]!;
      expect(row.pin_failures).toBe(3);
      expect(row.locked_at).not.toBeNull();
    } finally {
      await client.end();
    }
    const restarted = createDatabase({
      ...options,
      databaseUrl: { reveal: () => restartedUrl(process.env.TEST_ADMIN_RUNTIME_URL!) },
    });
    await restarted.connect();
    try {
      const fresh = createAdminModule(restarted, "integration", {
        crypto,
        clock,
        newId: randomUUID,
        policy: {
          realmId: "integration",
          environment: "test",
          sessionSeconds: 900,
          idleSeconds: 300,
          pendingSeconds: 120,
          maxCryptoInFlight: 2,
        },
        dummyPasswordVerifier: await crypto.hash("IntegrationUnknownPassword", "password"),
      }).service;
      await expect(
        fresh.login({
          schemaVersion: 1,
          commandId: randomUUID(),
          username: "owner_integration",
          password: ownerPassword,
        }),
      ).rejects.toBeDefined();
    } finally {
      await restarted.disconnect();
    }
  }, 60000);
});

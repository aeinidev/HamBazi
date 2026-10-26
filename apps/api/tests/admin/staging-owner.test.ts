import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import { describe, it, expect } from "vitest";
import { createAdminProvisioning } from "../../src/admin/application/provisioning.js";
import { adminFixture, ownerPin, password } from "./fixture.js";
import {
  assertStagingOperator,
  hiddenLine,
  parsePrivateEnvironment,
  stagingOwnerProfile,
  operatorDebugging,
} from "../../src/composition/admin-owner-private.js";
import {
  ownerStateSchema,
  planOwnerCeremony,
  stagingAuthority,
  verifyBackupReceipt,
  operatorDatabaseUrl,
  stagingOwnerPolicySchema,
} from "../../src/composition/admin-owner-state.js";
import {
  openOwnerBackup,
  sealOwnerBackup,
  type OwnerBackupCapsule,
  ownerDumpArguments,
} from "../../src/composition/admin-owner-backup.js";

const actor = {
  uid: 0,
  realm: "staging",
  environment: "staging",
  profile: stagingOwnerProfile,
  sshConnection: "192.0.2.20 50000 192.0.2.30 22",
  sshTty: "/dev/pts/7",
  actualTty: "/dev/pts/7",
  terminal: true,
  debugging: false,
  acknowledged: true,
};
const pending = { action: "bootstrap" as const, commandId: randomUUID(), digest: "a".repeat(64) };
const owner = randomUUID();
describe("explicit Staging SSH owner ceremony", () => {
  it("maps the container-only DB identity to a reviewed private host without weakening TLS or changing credentials", () => {
    const policy = stagingOwnerPolicySchema.parse({
      schemaVersion: 1,
      profile: stagingOwnerProfile,
      realm: "staging",
      environment: "staging",
      sourceRevision: "a".repeat(64),
      databaseHost: "10.89.18.20",
      databasePort: 5432,
      databaseCaFile: "/opt/hambazi/private/tls/data-ca.pem",
    });
    const original =
      "postgresql://hambazi_admin_bootstrap:synthetic-fixture@postgres-staging:5432/hambazi?sslmode=verify-full&sslrootcert=/run/hambazi/tls/data-ca.pem";
    const mapped = new URL(operatorDatabaseUrl(original, policy));
    expect(mapped.hostname).toBe("10.89.18.20");
    expect(mapped.username).toBe("hambazi_admin_bootstrap");
    expect(mapped.password).toBe("synthetic-fixture");
    expect(mapped.searchParams.get("sslmode")).toBe("verify-full");
    expect(mapped.searchParams.get("sslrootcert")).toBe(policy.databaseCaFile);
    expect(() => operatorDatabaseUrl(original.replace("verify-full", "require"), policy)).toThrow();
    expect(() =>
      operatorDatabaseUrl(original.replace("postgres-staging", "public.example"), policy),
    ).toThrow();
    expect(() =>
      stagingOwnerPolicySchema.parse({ ...policy, databaseHost: "203.0.113.10" }),
    ).toThrow();
  });
  it("requires root, matching private TTY, SSH, exact Staging and explicit action approval", () => {
    expect(() => assertStagingOperator(actor)).not.toThrow();
    expect(operatorDebugging({}, [])).toBe(false);
    for (const flag of [
      "--inspect",
      "--heapsnapshot-near-heap-limit=1",
      "--heapsnapshot-signal=SIGUSR2",
      "--tls-keylog=/tmp/forbidden",
    ])
      expect(operatorDebugging({}, [flag])).toBe(true);
    for (const name of ["NODE_OPTIONS", "NODE_V8_COVERAGE", "SSLKEYLOGFILE", "LD_PRELOAD"])
      expect(operatorDebugging({ [name]: "forbidden" }, [])).toBe(true);
    for (const bad of [
      { uid: 1000 },
      { realm: "production" },
      { environment: "production" },
      { profile: "dual-proof" },
      { sshConnection: undefined },
      { sshConnection: "192.0.2.1 999999 192.0.2.2 22" },
      { sshTty: "/dev/pts/8" },
      { terminal: false },
      { debugging: true },
      { acknowledged: false },
    ])
      expect(() => assertStagingOperator({ ...actor, ...bad })).toThrow(
        "ADMIN_PRIVATE_OPERATOR_REQUIRED",
      );
  });
  it("does not evaluate shell syntax or silently accept duplicate environment keys", () => {
    const text = "KEY=$(do-not-run)\nANOTHER=`do-not-run`\n";
    expect(parsePrivateEnvironment(text)).toEqual({
      KEY: "$(do-not-run)",
      ANOTHER: "`do-not-run`",
    });
    expect(() => parsePrivateEnvironment("KEY=1\nKEY=2")).toThrow();
    expect(() => parsePrivateEnvironment("export KEY=1")).toThrow();
  });
  it("binds private authority to this process, action, subject, digest and five-minute deadline", async () => {
    let now = 1000;
    const expected = {
      commandId: randomUUID(),
      username: "fixture",
      reasonCode: "INITIAL_OWNER_ENROLLMENT",
      digest: "a".repeat(64),
    };
    const authority = stagingAuthority(expected, () => now),
      binding = { ...expected, realmId: "staging" };
    expect(await authority.verify(authority.proof, binding)).toBe(true);
    expect(await authority.verify({ ...authority.proof }, binding)).toBe(false);
    for (const bad of [
      { realmId: "production" },
      { username: "other" },
      { commandId: randomUUID() },
      { reasonCode: "OWNER_PIN_RECOVERY" },
      { digest: "b".repeat(64) },
    ])
      expect(await authority.verify(authority.proof, { ...binding, ...bad })).toBe(false);
    now += 300000;
    expect(await authority.verify(authority.proof, binding)).toBe(false);
  });
  it("resumes only the same intent and closes bootstrap after enrollment or restore rollback", () => {
    const initial = planOwnerCeremony(null, null, pending);
    expect(planOwnerCeremony(initial, owner, pending)).toEqual(initial);
    expect(() =>
      planOwnerCeremony(initial, owner, { ...pending, digest: "b".repeat(64) }),
    ).toThrow();
    const closed = { ...initial, ownerId: owner, pending: null };
    expect(() => planOwnerCeremony(closed, owner, pending)).toThrow();
    expect(() => planOwnerCeremony(closed, null, pending)).toThrow();
    expect(() => planOwnerCeremony(null, owner, pending)).toThrow();
    expect(() => planOwnerCeremony(null, owner, { ...pending, action: "recover" })).toThrow();
    expect(planOwnerCeremony(closed, owner, { ...pending, action: "recover" }).ownerId).toBe(owner);
    expect(() => ownerStateSchema.parse({ ...closed, realm: "production" })).toThrow();
  });
  it("requires a fresh restore and off-server-copy receipt bound to the reviewed release", () => {
    const now = Date.now();
    const receipt = {
      schemaVersion: 1,
      profile: stagingOwnerProfile,
      realm: "staging",
      snapshotSHA256: "a".repeat(64),
      sourceRevision: "b".repeat(64),
      restored: true,
      offServerCopyVerified: true,
      checkedAtUTC: new Date(now - 1000).toISOString(),
    };
    expect(verifyBackupReceipt(receipt, "b".repeat(64), now)).toEqual(receipt);
    for (const bad of [
      { restored: false },
      { offServerCopyVerified: false },
      { sourceRevision: "c".repeat(64) },
      { checkedAtUTC: new Date(now + 1).toISOString() },
      { checkedAtUTC: new Date(now - 86400001).toISOString() },
    ])
      expect(() => verifyBackupReceipt({ ...receipt, ...bad }, "b".repeat(64), now)).toThrow();
  });
  it("never echoes private input, handles erase/cancel and restores terminal mode", async () => {
    const input = Object.assign(new PassThrough(), {
      isTTY: true,
      isRaw: false,
      setRawMode(raw: boolean) {
        this.isRaw = raw;
        return this;
      },
    });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    let printed = "";
    output.on("data", (data: Buffer) => {
      printed += data.toString();
    });
    const read = () =>
      hiddenLine(input as unknown as ReadStream, output as unknown as WriteStream, "Secret");
    const first = read();
    input.write(Buffer.from("NeverPrintThiX\u007fs\r"));
    expect(await first).toBe("NeverPrintThis");
    expect(printed).toBe("Secret: \n");
    expect(input.isRaw).toBe(false);
    const cancel = read();
    input.write(Buffer.from("DoNotPrint\u0003"));
    await expect(cancel).rejects.toThrow("CANCELLED");
    expect(input.isRaw).toBe(false);
    const paste = read();
    input.write(Buffer.from("a\nsecond-secret"));
    await expect(paste).rejects.toThrow("MULTILINE");
    expect(printed).not.toContain("DoNotPrint");
    expect(printed).not.toContain("second-secret");
  });
  it("refuses pipes rather than reading credentials from stdin scripts", async () => {
    await expect(
      hiddenLine(
        new PassThrough() as unknown as ReadStream,
        new PassThrough() as unknown as WriteStream,
        "Secret",
      ),
    ).rejects.toThrow("TTY");
  });
  it("requires current owner password for Staging recovery and revokes full and pending sessions", async () => {
    const f = await adminFixture({ realmId: "staging", recoveryPasswordRequired: true });
    await f.enroll();
    const login = () =>
      f.service.login({
        schemaVersion: 1,
        commandId: randomUUID(),
        username: "owner_fixture",
        password,
      });
    const a = await login();
    const full = await f.service.pin(a.token, {
      schemaVersion: 1,
      commandId: randomUUID(),
      pin: ownerPin,
    });
    const pendingSession = await login();
    const request = {
      schemaVersion: 1,
      commandId: randomUUID(),
      username: "owner_fixture",
      pin: "654321",
      confirmed: true,
      reasonCode: "OWNER_PIN_RECOVERY",
    };
    const before = structuredClone(f.state);
    await expect(f.provisioning.run(request, "synthetic-verified-authority")).rejects.toThrow(
      "FORBIDDEN",
    );
    await expect(
      f.provisioning.run(
        { ...request, password: "WrongPassword123" },
        "synthetic-verified-authority",
      ),
    ).rejects.toThrow("FORBIDDEN");
    expect(f.state).toEqual(before);
    const result = await f.provisioning.run(
      { ...request, password },
      "synthetic-verified-authority",
    );
    expect(result.operatorId).toBe(before.realm!.ownerId);
    expect(f.state.operators.get(result.operatorId)!.passwordVerifier).toBe(
      before.operators.get(result.operatorId)!.passwordVerifier,
    );
    await expect(f.service.authenticate(full.token)).rejects.toThrow();
    await expect(
      f.service.pin(pendingSession.token, {
        schemaVersion: 1,
        commandId: randomUUID(),
        pin: ownerPin,
      }),
    ).rejects.toThrow();
  });
  it("cannot opt another realm into the Staging recovery policy", async () => {
    await expect(
      adminFixture({ realmId: "production", recoveryPasswordRequired: true }),
    ).rejects.toThrow("STAGING_PROFILE");
  });
  it("fences password authentication against concurrent rotation and rolls back failed recovery audit", async () => {
    const f = await adminFixture({ realmId: "staging", recoveryPasswordRequired: true });
    await f.enroll();
    const request = {
      schemaVersion: 1,
      commandId: randomUUID(),
      username: "owner_fixture",
      password,
      pin: "654321",
      confirmed: true,
      reasonCode: "OWNER_PIN_RECOVERY",
    };
    f.failAudit();
    const before = structuredClone(f.state);
    await expect(f.provisioning.run(request, "synthetic-verified-authority")).rejects.toThrow();
    expect(f.state).toEqual(before);
    f.restoreAudit();
    const provision = createAdminProvisioning({
      repository: f.repository,
      realmId: "staging",
      clock: f.clock,
      newId: randomUUID,
      recoveryPasswordRequired: true,
      verifyAuthority: async () => true,
      crypto: {
        ...f.crypto,
        async verify(...args) {
          const ok = await f.crypto.verify(...args);
          await f.repository.atomic(async (tx) => {
            const id = (await tx.realm())!.ownerId!;
            const row = (await tx.operator(id))!;
            await tx.updateOperator(id, { credentialVersion: row.credentialVersion + 1 });
          });
          return ok;
        },
      },
    });
    await expect(provision.run(request, {})).rejects.toThrow("ADMIN_CONFLICT");
    expect(f.state.audit).toEqual(before.audit);
  });
});

describe("encrypted Staging owner backup", () => {
  const passphrase = "SyntheticIndependentBackupSecret123";
  const value: OwnerBackupCapsule = {
    schemaVersion: 1,
    scope: "staging-admin-six-tables",
    realm: "staging",
    createdAtUTC: new Date().toISOString(),
    sourceRevision: "a".repeat(64),
    schemaTag: "admin-local-identity+password-rotation-v1",
    runtimeEnvironment: "SYNTHETIC_PEPPER=not-real",
    operatorEnvironment: "SYNTHETIC_DB=not-real",
    checkpoint: null,
    dumpBase64: Buffer.from("PGDMPsynthetic-disposable-data").toString("base64"),
  };
  it("authenticates, encrypts and randomizes the complete capsule; no raw payload is present", () => {
    const first = sealOwnerBackup(value, passphrase),
      second = sealOwnerBackup(value, passphrase);
    expect(first.equals(second)).toBe(false);
    expect(first.includes(Buffer.from("SYNTHETIC_PEPPER"))).toBe(false);
    expect(openOwnerBackup(first, passphrase)).toEqual(value);
    expect(ownerDumpArguments.filter((a) => a.startsWith("--table="))).toHaveLength(6);
  });
  it("rejects wrong keys, corruption, truncation and wrong realm before restoration", () => {
    const encrypted = sealOwnerBackup(value, passphrase);
    expect(() => openOwnerBackup(encrypted, passphrase + "x")).toThrow("BACKUP_DENIED");
    for (const at of [0, 8, 24, 36, 52, encrypted.length - 1]) {
      const changed = Buffer.from(encrypted);
      changed[at] = changed[at]! ^ 1;
      expect(() => openOwnerBackup(changed, passphrase)).toThrow("BACKUP_DENIED");
    }
    expect(() => openOwnerBackup(encrypted.subarray(0, -1), passphrase)).toThrow();
    expect(() =>
      sealOwnerBackup(
        { ...value, realm: "production" } as unknown as OwnerBackupCapsule,
        passphrase,
      ),
    ).toThrow();
    expect(() => sealOwnerBackup(value, "too-short")).toThrow();
  });
});

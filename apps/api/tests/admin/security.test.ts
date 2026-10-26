import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { describe, it, expect } from "vitest";
import { adminAccess, adminGameScope, type AdminPrincipal } from "../../src/admin/domain/access.js";
import {
  createAdminProvisioningAuthority,
  adminProvisioningStatement,
} from "../../src/admin/infrastructure/provisioning-authority.js";
import { createAdminCrypto } from "../../src/admin/infrastructure/crypto.js";
import { adminFixture, password, ownerPin } from "./fixture.js";

const login = (
  f: Awaited<ReturnType<typeof adminFixture>>,
  username = "owner_fixture",
  pass = password,
) => f.service.login({ schemaVersion: 1, commandId: randomUUID(), username, password: pass });
const pin = (
  f: Awaited<ReturnType<typeof adminFixture>>,
  token: string,
  value = ownerPin,
  commandId = randomUUID(),
) => f.service.pin(token, { schemaVersion: 1, commandId, pin: value });
describe("local administrative authentication", () => {
  it("requires password and PIN independently; a pending credential has zero administrative authority", async () => {
    const f = await adminFixture();
    await f.enroll();
    const pending = await login(f);
    expect(pending.next).toBe("PIN_REQUIRED");
    await expect(f.service.access(pending.token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    const full = await pin(f, pending.token);
    expect(full.next).toBe("SIGNED_IN");
    expect((await f.service.access(full.token)).isOwner).toBe(true);
    await expect(pin(f, pending.token, "111111")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(f.state.operators.get(f.state.realm!.ownerId!)!.pinFailures).toBe(0);
  });
  it("does not open the PIN step or alter its counter for unknown usernames/wrong passwords", async () => {
    const f = await adminFixture();
    await f.enroll();
    for (const [user, pass] of [
      ["missing_fixture", password],
      ["owner_fixture", "IncorrectSyntheticPassword"],
    ])
      await expect(login(f, user, pass)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(f.state.sessions.size).toBe(0);
    expect(f.state.operators.get(f.state.realm!.ownerId!)!.pinFailures).toBe(0);
  });
  it("keeps the failure count across password logins, and locks permanently on the third distinct failure", async () => {
    const f = await adminFixture();
    await f.enroll();
    for (let n = 0; n < 3; n++) {
      const pending = await login(f);
      await expect(pin(f, pending.token, "111111")).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    }
    const owner = f.state.operators.get(f.state.realm!.ownerId!)!;
    expect(owner.pinFailures).toBe(3);
    expect(owner.lockedAt).not.toBeNull();
    f.clock.value += 86400000;
    await expect(login(f)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(f.state.audit.filter((e) => e.event === "OWNER_LOCKED")).toHaveLength(1);
  });
  it("deduplicates PIN failure retries and resets only after a fully successful login", async () => {
    const f = await adminFixture();
    await f.enroll();
    const pending = await login(f);
    const id = randomUUID();
    for (let n = 0; n < 2; n++)
      await expect(pin(f, pending.token, "999999", id)).rejects.toBeDefined();
    expect(f.state.operators.get(f.state.realm!.ownerId!)!.pinFailures).toBe(1);
    const successId = randomUUID();
    const full = await pin(f, pending.token, ownerPin, successId);
    expect((await pin(f, pending.token, ownerPin, successId)).token).toBe(full.token);
    expect(f.state.operators.get(f.state.realm!.ownerId!)!.pinFailures).toBe(0);
  });
  it("rejects expired pending credentials without counting a PIN attempt", async () => {
    const f = await adminFixture();
    await f.enroll();
    const pending = await login(f);
    f.clock.value += 120000;
    await expect(pin(f, pending.token, "999999")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(f.state.operators.get(f.state.realm!.ownerId!)!.pinFailures).toBe(0);
  });
  it("allows ordinary operators to sign in directly and rejects them for PIN changes", async () => {
    const f = await adminFixture();
    await f.enroll();
    const root = f.state.operators.get(f.state.realm!.ownerId!)!;
    await f.repository.atomic((tx) =>
      tx.createOperator({
        ...root,
        id: randomUUID(),
        username: "support_fixture",
        pinVerifier: null,
      }),
    );
    const full = await login(f, "support_fixture");
    expect(full.next).toBe("SIGNED_IN");
    expect((await f.service.access(full.token)).isOwner).toBe(false);
    await expect(
      f.service.changePin(full.token, {
        schemaVersion: 1,
        commandId: randomUUID(),
        password,
        currentPin: ownerPin,
        newPin: "234567",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("denies token replay after logout, epoch changes or account disable", async () => {
    const f = await adminFixture();
    await f.enroll();
    let full = await pin(f, (await login(f)).token);
    await f.service.logout(full.token, randomUUID());
    await expect(f.service.access(full.token)).rejects.toBeDefined();
    full = await pin(f, (await login(f)).token);
    f.state.operators.get(f.state.realm!.ownerId!)!.sessionEpoch++;
    await expect(f.service.access(full.token)).rejects.toBeDefined();
  });
  it("rolls back both the attempt and audit on evidence storage failure", async () => {
    const f = await adminFixture();
    await f.enroll();
    const pending = await login(f);
    f.failAudit();
    await expect(pin(f, pending.token, "999999")).rejects.toBeDefined();
    f.restoreAudit();
    expect(f.state.operators.get(f.state.realm!.ownerId!)!.pinFailures).toBe(0);
  });
  it("changes PIN only after reauthentication and revokes every prior full/pending session", async () => {
    const f = await adminFixture();
    await f.enroll();
    const full = await pin(f, (await login(f)).token);
    await f.service.changePin(full.token, {
      schemaVersion: 1,
      commandId: randomUUID(),
      password,
      currentPin: ownerPin,
      newPin: "654321",
    });
    await expect(f.service.access(full.token)).rejects.toBeDefined();
    const pending = await login(f);
    await expect(pin(f, pending.token, ownerPin)).rejects.toBeDefined();
    expect((await pin(f, pending.token, "654321")).next).toBe("SIGNED_IN");
    expect(JSON.stringify(f.state.audit)).not.toContain(password);
    expect(JSON.stringify(f.state.audit)).not.toContain(ownerPin);
  });
  it("counts a retried failed PIN change once and never counts it when the password is wrong", async () => {
    const f = await adminFixture();
    await f.enroll();
    const full = await pin(f, (await login(f)).token);
    const command = {
      schemaVersion: 1,
      commandId: randomUUID(),
      password,
      currentPin: "999999",
      newPin: "234567",
    };
    await expect(f.service.changePin(full.token, command)).rejects.toBeDefined();
    await expect(f.service.changePin(full.token, command)).rejects.toBeDefined();
    expect(f.state.operators.get(f.state.realm!.ownerId!)!.pinFailures).toBe(1);
    await expect(
      f.service.changePin(full.token, {
        ...command,
        commandId: randomUUID(),
        password: "IncorrectSyntheticPassword",
      }),
    ).rejects.toBeDefined();
    expect(f.state.operators.get(f.state.realm!.ownerId!)!.pinFailures).toBe(1);
  });
  it("uses salted Argon2id, independent PIN pepper and bounded verifier parameters", async () => {
    const f = await adminFixture();
    const a = await f.crypto.hash(ownerPin, "pin"),
      b = await f.crypto.hash(ownerPin, "pin");
    expect(a).not.toBe(b);
    expect(a.startsWith("$argon2id$")).toBe(true);
    expect(await f.crypto.verify(a, ownerPin, "password")).toBe(false);
    expect(await f.crypto.verify(a.replace("m=19456", "m=999999999"), ownerPin, "pin")).toBe(false);
    const wrong = createAdminCrypto({
      signingKey: { reveal: () => Buffer.alloc(32, 11).toString("base64url") },
      pinPepper: { reveal: () => Buffer.alloc(32, 44).toString("base64url") },
      commandKey: { reveal: () => Buffer.alloc(32, 33).toString("base64url") },
      issuer: "urn:hambazi:synthetic:admin",
      audience: "urn:hambazi:synthetic:console",
      realmId: "synthetic",
      clock: f.clock,
      memoryCost: 19456,
      timeCost: 2,
    });
    expect(await wrong.verify(a, ownerPin, "pin")).toBe(false);
  });
});
describe("OWNER and scoped entitlements", () => {
  const base: AdminPrincipal = {
    operatorId: randomUUID(),
    isOwner: false,
    environment: "test",
    authorizationVersion: 1,
    policyRevision: 1,
    grants: [],
  };
  it("denies unknown capabilities for everyone and gives OWNER every registered capability", () => {
    expect(adminAccess({ ...base, isOwner: true }, "matches.view")).toBe(true);
    expect(adminAccess({ ...base, isOwner: true }, "unknown.manage")).toBe(false);
    expect(adminGameScope({ ...base, isOwner: true }, "unknown.manage")).toEqual([]);
    expect(adminAccess(base, "matches.view")).toBe(false);
  });
  it("combines matching scopes and lets individual denial dominate", () => {
    const p = {
      ...base,
      grants: [
        {
          permission: "matches.view",
          environment: "test",
          gameIds: ["coup", "kahroba"],
          deny: false,
        },
        { permission: "matches.view", environment: "test", gameIds: ["coup"], deny: true },
      ],
    };
    expect(adminAccess(p, "matches.view", "coup")).toBe(false);
    expect(adminAccess(p, "matches.view", "kahroba")).toBe(true);
    expect(adminGameScope(p, "matches.view")).toEqual(["kahroba"]);
  });
});
describe("private server and ownership proof", () => {
  it("requires two independent action-bound signatures and rejects expired/replayed-subject evidence", async () => {
    const operator = generateKeyPairSync("ed25519"),
      ownership = generateKeyPairSync("ed25519");
    const now = Date.now();
    const verify = createAdminProvisioningAuthority({
      operatorPublicKey: operator.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ownershipPublicKey: ownership.publicKey.export({ type: "spki", format: "pem" }).toString(),
      clock: { nowMs: () => now },
    });
    const binding = {
      commandId: randomUUID(),
      realmId: "synthetic",
      username: "owner_fixture",
      reasonCode: "OWNER_PIN_RECOVERY",
      digest: "a".repeat(64),
    };
    const statement = { ...binding, issuedAt: now - 1, expiresAt: now + 1000 };
    const bytes = Buffer.from(adminProvisioningStatement(statement));
    const proof = {
      ...statement,
      operatorSignature: sign(null, bytes, operator.privateKey).toString("base64url"),
      ownershipSignature: sign(null, bytes, ownership.privateKey).toString("base64url"),
    };
    expect(await verify(proof, binding)).toBe(true);
    expect(await verify({ ...proof, ownershipSignature: proof.operatorSignature }, binding)).toBe(
      false,
    );
    expect(await verify(proof, { ...binding, username: "attacker" })).toBe(false);
    expect(await verify({ ...proof, expiresAt: now - 1 }, binding)).toBe(false);
  });
});

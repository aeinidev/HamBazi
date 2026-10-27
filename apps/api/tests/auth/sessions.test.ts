import { inspect } from "node:util";
import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decodeJwt, decodeProtectedHeader, SignJWT } from "jose";
import { sessionService } from "../../src/auth/application/sessions.js";
import { createSessionCodec } from "../../src/auth/infrastructure/session-jwt.js";
import type { SessionRecord } from "../../src/auth/domain/session.js";
import {
  commandId,
  fixture,
  initData,
  keyA,
  keyB,
  now,
  signing,
  userId,
} from "./session-fixtures.js";

async function issued(f = fixture()) {
  const result = await f.service.issue(initData(), commandId);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Synthetic issuance failed");
  return { f, result, raw: result.accessToken.reveal() };
}
describe("durable session application semantics", () => {
  it("never revalidates a pre-ban session after unban; only a fresh issuance uses the new eligibility generation", async () => {
    const f = fixture();
    let active = true,
      authVersion = 0;
    const users = {
      findActiveByTelegramId: async () =>
        active ? { userId, registrationCompleted: true, authVersion } : undefined,
      findActiveById: async () =>
        active ? { userId, registrationCompleted: true, authVersion } : undefined,
    };
    const service = sessionService({ ...f.deps, users });
    const result = await service.issue(initData(), commandId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    active = false;
    authVersion++;
    expect((await service.authenticate(result.accessToken.reveal())).ok).toBe(false);
    active = true;
    authVersion++;
    expect((await service.authenticate(result.accessToken.reveal())).ok).toBe(false);
    expect((await service.issue(initData(), commandId)).ok).toBe(false);
    const fresh = await service.issue(initData(), randomUUID());
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect((await service.authenticate(fresh.accessToken.reveal())).ok).toBe(true);
  });
  it("returns a validated photo only with issuance and never embeds it in the JWT or durable row", async () => {
    const f = fixture();
    const photo = "https://t.me/i/userpic/320/synthetic.jpg";
    const result = await f.service.issue(initData(42, now, undefined, photo), commandId);
    expect(result).toMatchObject({ ok: true, photoUrl: photo });
    if (!result.ok) return;
    expect(decodeJwt(result.accessToken.reveal())).not.toHaveProperty("photoUrl");
    expect([...f.rows.values()][0]).not.toHaveProperty("photoUrl");
    expect(await f.service.authenticate(result.accessToken.reveal())).not.toHaveProperty(
      "photoUrl",
    );
  });
  it("issues a redacted credential and returns a minimal v1 context", async () => {
    const { f, result, raw } = await issued();
    expect(await f.service.authenticate(raw)).toEqual({ ok: true, session: result.session });
    expect(result.session).toEqual({
      schemaVersion: 1,
      sessionId: expect.any(String),
      userId,
      expiresAt: now + 120,
    });
    expect(JSON.stringify(result)).not.toContain(raw);
    expect(inspect(result)).not.toContain(raw);
    expect(String(result.accessToken)).toBe("[REDACTED]");
    expect(decodeProtectedHeader(raw)).toEqual({
      alg: "HS256",
      typ: "hambazi-session+jwt",
      kid: "a",
    });
    expect(Object.keys(decodeJwt(raw)).sort()).toEqual([
      "aud",
      "exp",
      "iat",
      "iss",
      "jti",
      "sub",
      "v",
    ]);
  });
  it("retries one logical session without extending its expiry", async () => {
    const { f, result, raw } = await issued();
    f.clock.value += 30000;
    const retry = await f.service.issue(initData(), commandId.toUpperCase());
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.session).toEqual(result.session);
      expect(retry.accessToken.reveal() === raw).toBe(true);
    }
    expect(f.rows.size).toBe(1);
  });
  it("scopes the same issuance command to the authenticated user", async () => {
    const { f, raw } = await issued();
    const other = await f.service.issue(initData(43), commandId);
    expect(other.ok).toBe(true);
    if (other.ok) expect(other.accessToken.reveal() === raw).toBe(false);
    expect(f.rows.size).toBe(2);
  });
  it.each([-1, 0, 1])("enforces the exact expiry boundary offset %i", async (offset) => {
    const { f, raw } = await issued();
    f.clock.value = (now + 120) * 1000 + offset;
    expect((await f.service.authenticate(raw)).ok).toBe(offset < 0);
  });
  it("never recreates revoked or expired sessions on retries", async () => {
    const { f, raw } = await issued();
    expect(await f.service.revoke(raw)).toEqual({ ok: true });
    const timestamp = [...f.rows.values()][0]!.revokedAt;
    f.clock.value += 1000;
    expect(await f.service.revoke(raw)).toEqual({ ok: true });
    expect([...f.rows.values()][0]!.revokedAt).toBe(timestamp);
    expect((await f.service.authenticate(raw)).ok).toBe(false);
    expect((await f.service.issue(initData(), commandId)).ok).toBe(false);
    f.clock.value = (now + 120) * 1000;
    expect((await f.service.issue(initData(), commandId)).ok).toBe(false);
    expect(f.rows.size).toBe(1);
    expect((await f.service.issue(initData(), randomUUID())).ok).toBe(true);
  });
  it.each([null, "", "not-a-uuid", 42])(
    "rejects malformed issuance commands %#",
    async (command) => {
      const f = fixture();
      expect(await f.service.issue(initData(), command)).toMatchObject({
        ok: false,
        error: { code: "INVALID_INPUT" },
      });
      expect(f.rows.size).toBe(0);
    },
  );
  it("rejects forged, stale, unknown and disabled identity before persistence", async () => {
    const f = fixture();
    for (const raw of ["forged", initData(42, now - 301), initData(99)]) {
      expect((await f.service.issue(raw, commandId)).ok).toBe(false);
    }
    f.users.findActiveByTelegramId = async () => undefined;
    expect((await f.service.issue(initData(), commandId)).ok).toBe(false);
    expect(f.rows.size).toBe(0);
  });
  it("fails existing sessions closed when Users eligibility changes", async () => {
    const { f, raw } = await issued();
    f.users.findActiveById = async () => undefined;
    expect((await f.service.authenticate(raw)).ok).toBe(false);
    expect(await f.service.revoke(raw)).toEqual({ ok: true });
  });
  it.each(["userId", "keyId", "issuer", "audience", "issuedAt", "expiresAt", "schemaVersion"])(
    "rejects a valid JWT if durable %s no longer matches",
    async (field) => {
      const { f, raw, result } = await issued();
      const row = f.rows.get(result.session.sessionId)!;
      f.rows.set(row.id, {
        ...row,
        [field]: typeof row[field as keyof SessionRecord] === "number" ? 123 : "different",
      });
      expect((await f.service.authenticate(raw)).ok).toBe(false);
    },
  );
  it("requires durable state even for a valid signed token", async () => {
    const { f, raw } = await issued();
    f.rows.clear();
    expect((await f.service.authenticate(raw)).ok).toBe(false);
    expect((await f.service.revoke(raw)).ok).toBe(false);
  });
  it("sanitizes repository failures and never signs before successful commit", async () => {
    const f = fixture();
    const sign = vi.fn(f.codec.sign);
    const service = sessionService({ ...f.deps, codec: { ...f.codec, sign } });
    f.repository.createOrGet = async () => {
      throw new Error("synthetic private SQL");
    };
    const result = await service.issue(initData(), commandId);
    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Operation failed", retryable: false },
    });
    expect(sign).not.toHaveBeenCalled();
  });
  it("denies authentication and revocation when the database is unavailable", async () => {
    const { f, raw } = await issued();
    f.repository.find = async () => {
      throw new Error("private database diagnostic");
    };
    for (const result of [await f.service.authenticate(raw), await f.service.revoke(raw)]) {
      expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
      expect(JSON.stringify(result)).not.toContain("private");
    }
  });
  it("checks expiry again after delayed async validation", async () => {
    const { f, raw } = await issued();
    const find = f.repository.find;
    f.repository.find = async (id) => {
      f.clock.value += 120000;
      return find(id);
    };
    expect((await f.service.authenticate(raw)).ok).toBe(false);
  });
  it("does not return a token when revocation wins during issuance", async () => {
    const f = fixture();
    const sign = f.codec.sign;
    const codec = {
      ...f.codec,
      async sign(row: SessionRecord) {
        await f.repository.revoke(row.id, row.userId, now);
        return sign(row);
      },
    };
    expect((await sessionService({ ...f.deps, codec }).issue(initData(), commandId)).ok).toBe(
      false,
    );
  });
  it("rechecks Telegram freshness after slow issuance", async () => {
    const f = fixture();
    const sign = f.codec.sign;
    const codec = {
      ...f.codec,
      async sign(row: SessionRecord) {
        f.clock.value += 301000;
        return sign(row);
      },
    };
    expect(
      (
        await sessionService({ ...f.deps, codec, lifetimeSeconds: 1000 }).issue(
          initData(),
          commandId,
        )
      ).ok,
    ).toBe(false);
  });
  it.each([NaN, Infinity, -1, 0.5])("fails closed for invalid server clock %s", async (ms) => {
    const f = fixture();
    f.clock.value = ms;
    expect((await f.service.issue(initData(), commandId)).ok).toBe(false);
    expect((await f.service.authenticate("token")).ok).toBe(false);
  });
  it.each([0, -1, NaN, Infinity, 0.5])("rejects invalid lifetime %s", (lifetimeSeconds) => {
    expect(() => sessionService({ ...fixture().deps, lifetimeSeconds })).toThrow(
      "Invalid session lifetime",
    );
  });
});

describe("HS256 key and claim boundary", () => {
  it("produces an interoperable HS256 signature checked independently with Node crypto", async () => {
    const { raw } = await issued();
    const [header, payload, signature] = raw.split(".");
    const expected = createHmac("sha256", Buffer.from(keyA, "base64url"))
      .update(`${header}.${payload}`)
      .digest("base64url");
    expect(signature === expected).toBe(true);
  });
  it("does not emit tokens, raw Telegram input, or failure causes through console telemetry", async () => {
    const sinks = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "debug"),
    ];
    try {
      const { f, raw } = await issued();
      await f.service.authenticate(raw);
      await f.service.authenticate("synthetic-private-invalid-token");
      await f.service.revoke(raw);
      f.repository.createOrGet = async () => {
        throw new Error("synthetic-private-repository-error");
      };
      const result = await f.service.issue(initData(), commandId);
      expect(JSON.stringify(result)).not.toContain("synthetic-private");
      for (const sink of sinks) expect(sink).not.toHaveBeenCalled();
    } finally {
      for (const sink of sinks) sink.mockRestore();
    }
  });
  it.each([
    { alg: "none" },
    { alg: "HS384" },
    { typ: "JWT" },
    { kid: "unknown" },
    { jku: "https://attacker.invalid/keys" },
    { jwk: { kty: "oct", k: keyA } },
    { crit: [] },
  ])("rejects altered/unexpected protected headers %#", async (override) => {
    const { f, raw } = await issued();
    const parts = raw.split(".");
    parts[0] = Buffer.from(JSON.stringify({ ...decodeProtectedHeader(raw), ...override })).toString(
      "base64url",
    );
    expect((await f.service.authenticate(parts.join("."))).ok).toBe(false);
  });
  it.each([
    { iss: "wrong" },
    { aud: "wrong" },
    { aud: [signing.audience] },
    { v: 2 },
    { role: "admin" },
    { sub: "bad" },
    { jti: "bad" },
    { iat: now + 1 },
    { exp: now },
    { exp: now + 0.5 },
    { iat: "now" },
  ])("rejects correctly signed invalid claims %#", async (override) => {
    const { raw } = await issued();
    const payload: Record<string, unknown> = {
      ...decodeJwt<Record<string, unknown>>(raw),
      ...override,
    };
    const bad = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256", typ: "hambazi-session+jwt", kid: "a" })
      .sign(Buffer.from(keyA, "base64url"));
    expect(await createSessionCodec(signing).verify(bad, now)).toBeUndefined();
  });
  it.each(["sub", "jti", "iat", "exp", "iss", "aud", "v"])("requires claim %s", async (field) => {
    const { raw } = await issued();
    const payload = decodeJwt(raw);
    delete payload[field];
    const bad = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256", typ: "hambazi-session+jwt", kid: "a" })
      .sign(Buffer.from(keyA, "base64url"));
    expect(await createSessionCodec(signing).verify(bad, now)).toBeUndefined();
  });
  it.each([null, 42, {}, "", "x", "a.b.c", "x".repeat(4097)])(
    "bounds/rejects malformed tokens %#",
    async (raw) => {
      expect(await createSessionCodec(signing).verify(raw, now)).toBeUndefined();
    },
  );
  it("rejects a valid-format signature produced by another key", async () => {
    const { raw } = await issued();
    const bad = await new SignJWT(decodeJwt(raw))
      .setProtectedHeader({ alg: "HS256", typ: "hambazi-session+jwt", kid: "a" })
      .sign(Buffer.from(keyB, "base64url"));
    expect(await createSessionCodec(signing).verify(bad, now)).toBeUndefined();
  });
  it("retains original keys for retries and fails closed after key retirement", async () => {
    const { f, raw } = await issued();
    const rotated = createSessionCodec({
      ...signing,
      activeKeyId: "b",
      keys: [...signing.keys, { id: "b", secret: { reveal: () => keyB } }],
    });
    const service = sessionService({ ...f.deps, codec: rotated });
    expect((await service.authenticate(raw)).ok).toBe(true);
    const retry = await service.issue(initData(), commandId);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.accessToken.reveal() === raw).toBe(true);
    const retired = createSessionCodec({
      ...signing,
      activeKeyId: "b",
      keys: [{ id: "b", secret: { reveal: () => keyB } }],
    });
    expect((await sessionService({ ...f.deps, codec: retired }).authenticate(raw)).ok).toBe(false);
    expect(
      (await sessionService({ ...f.deps, codec: retired }).issue(initData(), commandId)).ok,
    ).toBe(false);
  });
  it.each(["", "short", Buffer.alloc(31).toString("base64url"), keyA + "=", "x".repeat(87)])(
    "rejects invalid key material %#",
    (key) => {
      expect(() =>
        createSessionCodec({ ...signing, keys: [{ id: "a", secret: { reveal: () => key } }] }),
      ).toThrow("Invalid session signing configuration");
    },
  );
  it("sanitizes key-provider failures and rejects duplicate/missing key IDs", () => {
    expect(() =>
      createSessionCodec({
        ...signing,
        keys: [
          {
            id: "a",
            secret: {
              reveal() {
                throw new Error("private secret");
              },
            },
          },
        ],
      }),
    ).toThrow("Invalid session signing configuration");
    expect(() => createSessionCodec({ ...signing, activeKeyId: "missing" })).toThrow();
    expect(() =>
      createSessionCodec({ ...signing, keys: [...signing.keys, ...signing.keys] }),
    ).toThrow();
    expect(() => createSessionCodec({ ...signing, issuer: "" })).toThrow();
  });
});

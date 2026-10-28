import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  hkdfSync,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { hash, verify, argon2id } from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import type { AdminCrypto, AdminSessionRecord } from "../application/ports.js";

export function createAdminCrypto(options: {
  signingKey: { reveal(): string };
  pinPepper: { reveal(): string };
  commandKey: { reveal(): string };
  issuer: string;
  audience: string;
  realmId: string;
  clock: { nowMs(): number };
  memoryCost: number;
  timeCost: number;
}): AdminCrypto {
  const key = Buffer.from(options.signingKey.reveal(), "base64url");
  const pepper = Buffer.from(options.pinPepper.reveal(), "base64url");
  const command = Buffer.from(options.commandKey.reveal(), "base64url");
  if (
    [key, pepper, command].some((v) => v.length !== 32) ||
    key.equals(pepper) ||
    key.equals(command) ||
    pepper.equals(command) ||
    !Number.isSafeInteger(options.memoryCost) ||
    options.memoryCost < 19456 ||
    options.memoryCost > 262144 ||
    !Number.isSafeInteger(options.timeCost) ||
    options.timeCost < 2 ||
    options.timeCost > 6
  )
    throw new Error("ADMIN_CRYPTO_CONFIGURATION_INVALID");
  const noteKey = Buffer.from(
    hkdfSync("sha256", command, options.realmId, "admin-restriction-note-v1", 32),
  );
  const input = (value: string, kind: "password" | "pin") =>
    kind === "pin"
      ? createHmac("sha256", pepper)
          .update(`admin-pin-v1:${options.realmId}:`)
          .update(value)
          .digest()
      : Buffer.from(value, "utf8");
  const payload = z.strictObject({
    v: z.literal(1),
    sub: z.uuid(),
    kind: z.enum(["PENDING", "FULL"]),
    iat: z.number().int(),
    exp: z.number().int(),
    iss: z.literal(options.issuer),
    aud: z.literal(options.audience),
  });
  const implementation: AdminCrypto = {
    sealPrivateNote(value, binding) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", noteKey, iv);
      cipher.setAAD(Buffer.from(binding));
      return Buffer.concat([
        iv,
        cipher.update(value, "utf8"),
        cipher.final(),
        cipher.getAuthTag(),
      ]).toString("base64url");
    },
    openPrivateNote(value, binding) {
      const data = Buffer.from(value, "base64url");
      if (data.length < 29 || data.length > 9000) throw new Error("ADMIN_NOTE_INVALID");
      const decipher = createDecipheriv("aes-256-gcm", noteKey, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(binding));
      decipher.setAuthTag(data.subarray(-16));
      return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString(
        "utf8",
      );
    },
    async hash(value, kind) {
      return hash(input(value, kind), {
        type: argon2id,
        memoryCost: options.memoryCost,
        timeCost: options.timeCost,
        parallelism: 1,
        hashLength: 32,
        salt: randomBytes(16),
      });
    },
    async verify(encoded, value, kind) {
      try {
        // Bound attacker-controlled/corrupt stored PHC parameters before allocating memory.
        const match =
          /^\$argon2id\$v=19\$m=(\d+),(?:t=(\d+),p=1|p=1,t=(\d+))\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/.exec(
            encoded,
          );
        if (
          !match ||
          Number(match[1]) !== options.memoryCost ||
          Number(match[2] ?? match[3]) !== options.timeCost
        )
          return false;
        return await verify(encoded, input(value, kind));
      } catch {
        return false;
      }
    },
    digest(value) {
      return createHmac("sha256", command)
        .update(`intent-v1:${options.realmId}:`)
        .update(value)
        .digest("hex");
    },
    csrf(id) {
      return createHmac("sha256", command)
        .update(`csrf-v1:${options.realmId}:${id}`)
        .digest("base64url");
    },
    async sign(s: AdminSessionRecord) {
      return new SignJWT({ v: 1, kind: s.kind })
        .setProtectedHeader({ alg: "HS256", typ: "hambazi-admin+jwt" })
        .setSubject(s.id)
        .setIssuer(options.issuer)
        .setAudience(options.audience)
        .setIssuedAt(Math.floor(s.issuedAt.getTime() / 1000))
        .setExpirationTime(Math.floor(s.expiresAt.getTime() / 1000))
        .sign(key);
    },
    async verifyToken(value) {
      try {
        if (typeof value !== "string" || value.length > 2048) return null;
        const verified = await jwtVerify(value, key, {
          algorithms: ["HS256"],
          typ: "hambazi-admin+jwt",
          issuer: options.issuer,
          audience: options.audience,
          currentDate: new Date(options.clock.nowMs()),
          requiredClaims: ["v", "sub", "kind", "iat", "exp"],
        });
        const p = payload.parse(verified.payload);
        if (p.iat * 1000 > options.clock.nowMs() || p.exp <= p.iat) return null;
        return { id: p.sub, kind: p.kind };
      } catch {
        return null;
      }
    },
  };
  return Object.freeze(implementation);
}
export function constantAdminEqual(a: unknown, b: string) {
  if (typeof a !== "string" || a.length !== b.length) return false;
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

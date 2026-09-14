import { SecretValue } from "@hambazi/config";
import { decodeProtectedHeader, jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import type { SessionCodec } from "../application/session-ports.js";
import type { SessionRecord } from "../domain/session.js";

export interface SessionSigningOptions {
  readonly activeKeyId: string;
  readonly keys: readonly { readonly id: string; readonly secret: { reveal(): string } }[];
  readonly issuer: string;
  readonly audience: string;
}
const keyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const binding = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[\x21-\x7E]+$/);
const seconds = z.number().int().min(0).max(8640000000000);
const headerSchema = z.strictObject({
  alg: z.literal("HS256"),
  typ: z.literal("hambazi-session+jwt"),
  kid: keyId,
});
const payloadSchema = z.strictObject({
  v: z.literal(1),
  sub: z.uuid(),
  jti: z.uuid(),
  iat: seconds,
  exp: seconds,
  iss: binding,
  aud: binding,
});

export function createSessionCodec(options: SessionSigningOptions): SessionCodec {
  const keys = new Map<string, Uint8Array>();
  const { activeKeyId, issuer, audience } = options;
  try {
    if (
      !keyId.safeParse(activeKeyId).success ||
      !binding.safeParse(issuer).success ||
      !binding.safeParse(audience).success ||
      options.keys.length < 1 ||
      options.keys.length > 8
    )
      throw new Error();
    const unique = new Set<string>();
    for (const entry of options.keys) {
      const encoded = entry.secret.reveal();
      if (
        !keyId.safeParse(entry.id).success ||
        keys.has(entry.id) ||
        typeof encoded !== "string" ||
        !/^[A-Za-z0-9_-]{43,86}$/.test(encoded)
      )
        throw new Error();
      const bytes = Buffer.from(encoded, "base64url");
      if (
        bytes.length < 32 ||
        bytes.length > 64 ||
        bytes.toString("base64url") !== encoded ||
        unique.has(encoded)
      )
        throw new Error();
      unique.add(encoded);
      keys.set(entry.id, bytes);
    }
    if (!keys.has(activeKeyId)) throw new Error();
  } catch {
    throw new Error("Invalid session signing configuration");
  }

  return Object.freeze({
    activeKeyId,
    issuer,
    audience,
    async sign(record: SessionRecord) {
      try {
        const payload = payloadSchema.parse({
          v: record.schemaVersion,
          sub: record.userId,
          jti: record.id,
          iat: record.issuedAt,
          exp: record.expiresAt,
          iss: record.issuer,
          aud: record.audience,
        });
        const key = keys.get(record.keyId);
        if (
          !key ||
          record.revokedAt !== null ||
          payload.exp <= payload.iat ||
          payload.iss !== issuer ||
          payload.aud !== audience
        )
          throw new Error();
        const value = await new SignJWT(payload)
          .setProtectedHeader({ alg: "HS256", typ: "hambazi-session+jwt", kid: record.keyId })
          .sign(key);
        return new SecretValue(value);
      } catch {
        throw new Error("Session signing failed");
      }
    },
    async verify(token: unknown, now: number) {
      try {
        if (
          typeof token !== "string" ||
          token.length === 0 ||
          token.length > 4096 ||
          !Number.isSafeInteger(now) ||
          now < 0 ||
          now > 8640000000000
        )
          return;
        const header = headerSchema.safeParse(decodeProtectedHeader(token));
        if (!header.success) return;
        const key = keys.get(header.data.kid);
        if (!key) return;
        const verified = await jwtVerify(token, key, {
          algorithms: ["HS256"],
          typ: "hambazi-session+jwt",
          issuer,
          audience,
          requiredClaims: ["sub", "jti", "iat", "exp", "iss", "aud", "v"],
          currentDate: new Date(now * 1000),
          clockTolerance: 0,
        });
        const parsed = payloadSchema.safeParse(verified.payload);
        if (!parsed.success) return;
        const p = parsed.data;
        if (p.iat > now || p.exp <= now || p.exp <= p.iat) return;
        return Object.freeze({
          schemaVersion: p.v,
          id: p.jti,
          userId: p.sub,
          keyId: header.data.kid,
          issuer: p.iss,
          audience: p.aud,
          issuedAt: p.iat,
          expiresAt: p.exp,
        });
      } catch {
        return;
      }
    },
  });
}

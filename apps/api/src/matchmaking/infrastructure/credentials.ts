import { SecretValue } from "@hambazi/config";
import { decodeProtectedHeader, jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import type { Credentials } from "../application/contracts.js";
const keyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const binding = z.string().regex(/^[\x21-\x7E]{1,256}$/);
const seconds = z.number().int().min(0).max(8640000000000);
const header = z.strictObject({
  alg: z.literal("HS256"),
  typ: z.literal("hambazi-admission+jwt"),
  kid: keyId,
});
const payload = z.strictObject({
  v: z.literal(1),
  sub: z.uuid(),
  sid: z.uuid(),
  tid: z.uuid(),
  mid: z.uuid(),
  iat: seconds,
  exp: seconds,
  iss: binding,
  aud: binding,
});
export function createAdmissionCredentials(options: {
  clock: { nowMs(): number };
  lifetimeSeconds: number;
  activeKeyId: string;
  keys: readonly { id: string; secret: { reveal(): string } }[];
  issuer: string;
  audience: string;
}): Credentials {
  const keys = new Map<string, Uint8Array>();
  const { activeKeyId, issuer, audience, lifetimeSeconds, clock } = options;
  try {
    if (
      !keyId.safeParse(activeKeyId).success ||
      !binding.safeParse(issuer).success ||
      !binding.safeParse(audience).success ||
      !Number.isInteger(lifetimeSeconds) ||
      lifetimeSeconds < 1 ||
      lifetimeSeconds > 300 ||
      options.keys.length < 1 ||
      options.keys.length > 8
    )
      throw new Error();
    const unique = new Set<string>();
    for (const entry of options.keys) {
      const raw = entry.secret.reveal();
      if (
        !keyId.safeParse(entry.id).success ||
        keys.has(entry.id) ||
        !/^[A-Za-z0-9_-]{43,86}$/.test(raw) ||
        unique.has(raw)
      )
        throw new Error();
      const bytes = Buffer.from(raw, "base64url");
      if (bytes.length < 32 || bytes.length > 64 || bytes.toString("base64url") !== raw)
        throw new Error();
      unique.add(raw);
      keys.set(entry.id, bytes);
    }
    if (!keys.has(activeKeyId)) throw new Error();
  } catch {
    throw new Error("Invalid admission signing configuration");
  }
  function now() {
    const ms = clock.nowMs();
    if (!Number.isSafeInteger(ms) || ms < 0 || ms > 8640000000000000)
      throw new Error("Invalid admission clock");
    return Math.floor(ms / 1000);
  }
  const codec: Credentials = {
    async issue(session, ticket) {
      try {
        const iat = now();
        const exp = Math.min(iat + lifetimeSeconds, session.expiresAt);
        if (ticket.status !== "MATCHED" || ticket.actorUserId !== session.userId || exp <= iat)
          throw new Error();
        const claims = payload.parse({
          v: 1,
          sub: session.userId,
          sid: session.sessionId,
          tid: ticket.ticketId,
          mid: ticket.matchId,
          iat,
          exp,
          iss: issuer,
          aud: audience,
        });
        const token = await new SignJWT(claims)
          .setProtectedHeader({ alg: "HS256", typ: "hambazi-admission+jwt", kid: activeKeyId })
          .sign(keys.get(activeKeyId)!);
        return { token: new SecretValue(token), expiresAt: exp };
      } catch {
        throw new Error("Admission signing failed");
      }
    },
    async verify(token, session, ticket) {
      try {
        if (typeof token !== "string" || token.length > 4096 || ticket.status !== "MATCHED")
          return false;
        const h = header.safeParse(decodeProtectedHeader(token));
        if (!h.success) return false;
        const key = keys.get(h.data.kid);
        if (!key) return false;
        const at = now();
        const verified = await jwtVerify(token, key, {
          algorithms: ["HS256"],
          typ: "hambazi-admission+jwt",
          issuer,
          audience,
          currentDate: new Date(at * 1000),
          clockTolerance: 0,
        });
        const p = payload.parse(verified.payload);
        return (
          p.iat <= at &&
          p.exp > at &&
          p.exp > p.iat &&
          p.exp - p.iat <= lifetimeSeconds &&
          p.exp <= session.expiresAt &&
          session.expiresAt > at &&
          p.sub === session.userId &&
          p.sub === ticket.actorUserId &&
          p.sid === session.sessionId &&
          p.tid === ticket.ticketId &&
          p.mid === ticket.matchId
        );
      } catch {
        return false;
      }
    },
  };
  return Object.freeze(codec);
}

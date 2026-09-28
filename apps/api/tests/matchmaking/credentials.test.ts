import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  createAdmissionCredentials,
  admissionSchema,
  searchSchema,
  foundSchema,
  type Session,
} from "../../src/matchmaking/index.js";
import type { AdmissionTicket } from "../../src/matches/index.js";
const key = Buffer.alloc(32, 73).toString("base64url");
function fixture() {
  const clock = {
    value: 1900000000000,
    nowMs() {
      return this.value;
    },
  };
  const options = {
    clock,
    lifetimeSeconds: 30,
    issuer: "https://admission.invalid",
    audience: "match",
    activeKeyId: "one",
    keys: [{ id: "one", secret: { reveal: () => key } }],
  };
  const session: Session = {
    schemaVersion: 1,
    userId: randomUUID(),
    sessionId: randomUUID(),
    expiresAt: clock.value / 1000 + 900,
  };
  const ticket: AdmissionTicket = {
    schemaVersion: 1,
    ticketId: randomUUID(),
    commandId: randomUUID(),
    actorUserId: session.userId,
    gameId: "coup",
    mode: "fixture",
    capacity: 2,
    status: "MATCHED",
    generation: 2,
    expiresAt: clock.value + 120000,
    reservationId: randomUUID(),
    reservationUntil: clock.value + 10000,
    matchId: randomUUID(),
  };
  return { clock, options, session, ticket, codec: createAdmissionCredentials(options) };
}
it("issues redacted credentials bound to session, ticket and committed match", async () => {
  const f = fixture();
  const issued = await f.codec.issue(f.session, f.ticket);
  expect(await f.codec.verify(issued.token.reveal(), f.session, f.ticket)).toBe(true);
  expect(issued.expiresAt).toBe(f.clock.value / 1000 + 30);
  for (const serialized of [JSON.stringify(issued), inspect(issued), String(issued.token)])
    expect(serialized).not.toContain(issued.token.reveal());
  expect(
    foundSchema.safeParse({
      schemaVersion: 1,
      ticketId: f.ticket.ticketId,
      matchId: f.ticket.matchId,
      admissionToken: issued.token.reveal(),
      expiresAt: issued.expiresAt,
    }).success,
  ).toBe(true);
});
it.each([
  "user",
  "session",
  "ticket",
  "match",
  "status",
  "expired",
  "tamper",
  "audience",
  "issuer",
  "removed-key",
  "future",
])("rejects %s mismatch", async (kind) => {
  const f = fixture();
  const issued = await f.codec.issue(f.session, f.ticket);
  let token = issued.token.reveal();
  let codec = f.codec;
  if (kind === "user") f.session.userId = randomUUID();
  if (kind === "session") f.session.sessionId = randomUUID();
  if (kind === "ticket") f.ticket.ticketId = randomUUID();
  if (kind === "match") f.ticket.matchId = randomUUID();
  if (kind === "status") f.ticket.status = "CANCELLED";
  if (kind === "expired") f.clock.value += 30000;
  if (kind === "tamper") token = token.slice(0, -12) + "AAAAAAAAAAAA";
  if (kind === "audience") codec = createAdmissionCredentials({ ...f.options, audience: "other" });
  if (kind === "issuer") codec = createAdmissionCredentials({ ...f.options, issuer: "other" });
  if (kind === "removed-key")
    codec = createAdmissionCredentials({
      ...f.options,
      activeKeyId: "two",
      keys: [{ id: "two", secret: { reveal: () => Buffer.alloc(32, 74).toString("base64url") } }],
    });
  if (kind === "future") f.clock.value -= 1000;
  expect(await codec.verify(token, f.session, f.ticket)).toBe(false);
});
it("caps credential lifetime at session expiry and rejects exact expiry", async () => {
  const f = fixture();
  f.session.expiresAt = f.clock.value / 1000 + 2;
  const issued = await f.codec.issue(f.session, f.ticket);
  expect(issued.expiresAt).toBe(f.session.expiresAt);
  f.clock.value += 2000;
  expect(await f.codec.verify(issued.token.reveal(), f.session, f.ticket)).toBe(false);
  await expect(f.codec.issue(f.session, f.ticket)).rejects.toThrow("Admission signing failed");
});
it("permits normal key rotation without accepting another token purpose or extended lifetime", async () => {
  const f = fixture();
  const issued = await f.codec.issue(f.session, f.ticket);
  const rotated = createAdmissionCredentials({
    ...f.options,
    activeKeyId: "two",
    keys: [
      ...f.options.keys,
      { id: "two", secret: { reveal: () => Buffer.alloc(32, 74).toString("base64url") } },
    ],
  });
  expect(await rotated.verify(issued.token.reveal(), f.session, f.ticket)).toBe(true);
  const claims = JSON.parse(
    Buffer.from(issued.token.reveal().split(".")[1]!, "base64url").toString(),
  ) as Record<string, unknown>;
  for (const typ of ["hambazi-session+jwt", "JWT"]) {
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256", typ, kid: "one" })
      .sign(Buffer.from(key, "base64url"));
    expect(await f.codec.verify(token, f.session, f.ticket)).toBe(false);
  }
  const token = await new SignJWT({ ...claims, exp: f.clock.value / 1000 + 600 })
    .setProtectedHeader({ alg: "HS256", typ: "hambazi-admission+jwt", kid: "one" })
    .sign(Buffer.from(key, "base64url"));
  expect(await f.codec.verify(token, f.session, f.ticket)).toBe(false);
});
it.each([0, 301, 1.5, NaN])("rejects invalid lifetime %s", (lifetimeSeconds) => {
  expect(() => createAdmissionCredentials({ ...fixture().options, lifetimeSeconds })).toThrow(
    "Invalid admission signing configuration",
  );
});
it("rejects unsafe keys and strict intent injection, while receivers allow additive fields", () => {
  const f = fixture();
  expect(() =>
    createAdmissionCredentials({
      ...f.options,
      keys: [{ id: "one", secret: { reveal: () => "secret" } }],
    }),
  ).toThrow();
  const search = {
    schemaVersion: 1,
    commandId: randomUUID(),
    gameId: "coup",
    mode: "fixture",
    capacity: 2,
  };
  expect(searchSchema.safeParse(search).success).toBe(true);
  for (const extra of [
    { userId: randomUUID() },
    { engineVersion: "fake" },
    { capacity: 65 },
    { mode: "../queue" },
  ])
    expect(searchSchema.safeParse({ ...search, ...extra }).success).toBe(false);
  expect(
    admissionSchema.safeParse({
      schemaVersion: 1,
      ticketId: f.ticket.ticketId,
      admissionToken: "x",
      userId: f.session.userId,
    }).success,
  ).toBe(false);
});

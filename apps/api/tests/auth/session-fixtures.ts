import { createHmac, randomUUID } from "node:crypto";
import { createTelegramVerifier } from "../../src/auth/index.js";
import type { SessionRepository } from "../../src/auth/application/session-ports.js";
import type { SessionRecord } from "../../src/auth/domain/session.js";
import { createSessionCodec } from "../../src/auth/infrastructure/session-jwt.js";
import { sessionService } from "../../src/auth/application/sessions.js";
import type { UserIdentityPort } from "../../src/users/index.js";

// Explicit synthetic keys and timestamps; never used in runtime configuration.
export const keyA = Buffer.alloc(32, 11).toString("base64url");
export const keyB = Buffer.alloc(32, 22).toString("base64url");
export const signing = {
  activeKeyId: "a",
  keys: [{ id: "a", secret: { reveal: () => keyA } }],
  issuer: "urn:hambazi:test:api",
  audience: "urn:hambazi:test:mini-app",
};
export const botToken = "123456789:SessionSyntheticBot";
export const now = 1700000000;
export const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const otherUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const commandId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export function initData(id = 42, date = now): string {
  const fields = { auth_date: String(date), user: JSON.stringify({ id, first_name: "Synthetic" }) };
  const key = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", key)
    .update(`auth_date=${fields.auth_date}\nuser=${fields.user}`)
    .digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
export const telegram = createTelegramVerifier(
  { reveal: () => botToken },
  {
    maxAgeSeconds: 300,
    maxFutureSkewSeconds: 30,
    maxBytes: 4096,
    maxFields: 16,
  },
);
export function fixture() {
  const clock = {
    value: now * 1000,
    nowMs() {
      return this.value;
    },
  };
  const rows = new Map<string, SessionRecord>();
  const repository: SessionRepository = {
    async createOrGet(candidate) {
      const previous = [...rows.values()].find(
        (r) => r.userId === candidate.userId && r.commandId === candidate.commandId,
      );
      if (previous) return previous;
      rows.set(candidate.id, Object.freeze({ ...candidate }));
      return candidate;
    },
    async find(id) {
      return rows.get(id);
    },
    async revoke(id, owner, time) {
      const row = rows.get(id);
      if (row && row.userId === owner && row.revokedAt === null)
        rows.set(id, { ...row, revokedAt: time });
    },
  };
  const users: UserIdentityPort = {
    async findActiveByTelegramId(id) {
      return id === "42" ? { userId } : id === "43" ? { userId: otherUserId } : undefined;
    },
    async findActiveById(id) {
      return [userId, otherUserId].includes(id) ? { userId: id } : undefined;
    },
  };
  const codec = createSessionCodec(signing);
  const deps = {
    repository,
    users,
    codec,
    clock,
    telegram,
    newSessionId: randomUUID,
    lifetimeSeconds: 120,
  };
  return { ...deps, rows, deps, service: sessionService(deps) };
}

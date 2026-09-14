import { createErrorEnvelope } from "@hambazi/contracts";
import { z } from "zod";
import type { UserIdentityPort } from "../../users/index.js";
import { isLiveSession, type SessionContext, type SessionRecord } from "../domain/session.js";
import type { TelegramVerifier } from "./telegram-verifier.js";
import type {
  AuthSessions,
  SessionClock,
  SessionCodec,
  SessionClaims,
  SessionRepository,
} from "./session-ports.js";

const uuid = z.uuid();
function context(record: SessionRecord): SessionContext {
  return Object.freeze({
    schemaVersion: 1,
    sessionId: record.id,
    userId: record.userId,
    expiresAt: record.expiresAt,
  });
}
function matches(row: SessionRecord, claims: SessionClaims): boolean {
  return (
    row.id === claims.id &&
    row.userId === claims.userId &&
    row.schemaVersion === claims.schemaVersion &&
    row.keyId === claims.keyId &&
    row.issuer === claims.issuer &&
    row.audience === claims.audience &&
    row.issuedAt === claims.issuedAt &&
    row.expiresAt === claims.expiresAt
  );
}

export function sessionService(deps: {
  repository: SessionRepository;
  codec: SessionCodec;
  telegram: TelegramVerifier;
  users: UserIdentityPort;
  clock: SessionClock;
  newSessionId(): string;
  lifetimeSeconds: number;
}): AuthSessions {
  const { repository, codec, telegram, users, clock, newSessionId, lifetimeSeconds } = deps;
  if (
    !Number.isSafeInteger(lifetimeSeconds) ||
    lifetimeSeconds < 1 ||
    lifetimeSeconds > 8640000000000
  )
    throw new Error("Invalid session lifetime");
  function time() {
    const ms = clock.nowMs();
    if (!Number.isSafeInteger(ms) || ms < 0 || ms > 8640000000000000)
      throw new Error("Invalid server clock");
    return { ms, seconds: Math.floor(ms / 1000) };
  }
  const denied = () => createErrorEnvelope("UNAUTHENTICATED");
  const failed = () => createErrorEnvelope("INTERNAL_ERROR");
  return Object.freeze({
    async issue(initData: unknown, commandId: unknown) {
      try {
        const command = uuid.safeParse(commandId);
        if (!command.success) return createErrorEnvelope("INVALID_INPUT");
        const start = time();
        const verified = telegram.verify(initData, start.ms);
        if (!verified.ok) return denied();
        const user = await users.findActiveByTelegramId(verified.identity.telegramUserId);
        if (!user || !uuid.safeParse(user.userId).success) return denied();
        const issuedAt = time().seconds;
        if (issuedAt < start.seconds) return failed();
        const expiresAt = issuedAt + lifetimeSeconds;
        if (!Number.isSafeInteger(expiresAt) || expiresAt > 8640000000000) return failed();
        const id = newSessionId();
        if (!uuid.safeParse(id).success) return failed();
        const record = await repository.createOrGet({
          id,
          userId: user.userId,
          commandId: command.data.toLowerCase(),
          schemaVersion: 1,
          keyId: codec.activeKeyId,
          issuer: codec.issuer,
          audience: codec.audience,
          issuedAt,
          expiresAt,
          revokedAt: null,
        });
        if (
          record.userId !== user.userId ||
          record.commandId !== command.data.toLowerCase() ||
          !isLiveSession(record, time().seconds)
        )
          return denied();
        const accessToken = await codec.sign(record);
        // Recheck after async work. Never return credentials for a known revoked/expired row.
        const eligible = await users.findActiveById(record.userId);
        const current = await repository.find(record.id);
        const end = time();
        if (
          end.seconds < start.seconds ||
          !eligible ||
          eligible.userId !== record.userId ||
          !current ||
          !matches(current, record) ||
          !isLiveSession(current, end.seconds) ||
          !telegram.verify(initData, end.ms).ok
        )
          return denied();
        return { ok: true as const, session: context(current), accessToken };
      } catch {
        return failed();
      }
    },
    async authenticate(token: unknown) {
      try {
        const start = time().seconds;
        const claims = await codec.verify(token, start);
        if (!claims) return denied();
        const user = await users.findActiveById(claims.userId);
        if (!user || user.userId !== claims.userId) return denied();
        const row = await repository.find(claims.id);
        const now = time().seconds;
        if (now < start || !row || !matches(row, claims) || !isLiveSession(row, now))
          return denied();
        return { ok: true as const, session: context(row) };
      } catch {
        return failed();
      }
    },
    async revoke(token: unknown) {
      try {
        const start = time().seconds;
        const claims = await codec.verify(token, start);
        if (!claims) return denied();
        const row = await repository.find(claims.id);
        const now = time().seconds;
        if (
          now < start ||
          !row ||
          !matches(row, claims) ||
          row.issuedAt > now ||
          row.expiresAt <= now
        )
          return denied();
        await repository.revoke(row.id, row.userId, now);
        return { ok: true as const };
      } catch {
        return failed();
      }
    },
  });
}

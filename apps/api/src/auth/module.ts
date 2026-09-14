import type { TelegramVerifier } from "./application/telegram-verifier.js";
import type { TelegramVerificationPolicy } from "./domain/telegram-identity.js";
import { telegramHmacVerifier } from "./infrastructure/telegram-hmac.js";
import { randomUUID } from "node:crypto";
import type { UserIdentityPort } from "../users/index.js";
import type { AuthSessions, SessionClock } from "./application/session-ports.js";
import { sessionService } from "./application/sessions.js";
import { createSessionRepository } from "./infrastructure/repositories/sessions.js";
import { createSessionCodec, type SessionSigningOptions } from "./infrastructure/session-jwt.js";

/** Transport-free assembly. Database ownership is selected only in repository adapters. */
export function createAuthSessions(options: {
  database: Parameters<typeof createSessionRepository>[0];
  users: UserIdentityPort;
  telegram: TelegramVerifier;
  clock: SessionClock;
  lifetimeSeconds: number;
  signing: SessionSigningOptions;
}): AuthSessions {
  return sessionService({
    repository: createSessionRepository(options.database),
    codec: createSessionCodec(options.signing),
    users: options.users,
    telegram: options.telegram,
    clock: options.clock,
    lifetimeSeconds: options.lifetimeSeconds,
    newSessionId: randomUUID,
  });
}

/** Composition entry; imports do not access environment, storage, network, or logs. */
export function createTelegramVerifier(
  botToken: { reveal(): string },
  policy: TelegramVerificationPolicy,
): TelegramVerifier {
  return telegramHmacVerifier(botToken, policy);
}

import type { TelegramVerifier } from "./application/telegram-verifier.js";
import type { TelegramVerificationPolicy } from "./domain/telegram-identity.js";
import { telegramHmacVerifier } from "./infrastructure/telegram-hmac.js";
import { randomUUID } from "node:crypto";
import type { UserIdentityPort } from "../users/index.js";
import type { AuthSessions, SessionClock } from "./application/session-ports.js";
import { sessionService } from "./application/sessions.js";
import { createSessionRepository } from "./infrastructure/repositories/sessions.js";
import { createSessionCodec, type SessionSigningOptions } from "./infrastructure/session-jwt.js";
import { botOnboardingService } from "./application/bot-onboarding.js";
import { createBotOnboardingRepository } from "./infrastructure/repositories/bot-onboarding.js";
import { botCleanupService } from "./application/bot-cleanup.js";
import { ownerAdmissionPolicy, type OwnerAdmission } from "./application/owner-admission.js";
import { ownerFileSource } from "./infrastructure/owner-file.js";

export function createFileOwnerAdmission(file: string, users?: UserIdentityPort): OwnerAdmission {
  return ownerAdmissionPolicy({ readOwner: ownerFileSource(file), ...(users ? { users } : {}) });
}

export function createBotOnboardingCleanup(
  database: Parameters<typeof createBotOnboardingRepository>[0],
  clock: SessionClock,
) {
  return botCleanupService(createBotOnboardingRepository(database), clock);
}

export function createBotOnboarding(
  options: Omit<Parameters<typeof botOnboardingService>[0], "repository" | "newId"> & {
    database: Parameters<typeof createBotOnboardingRepository>[0];
  },
) {
  return botOnboardingService({
    ...options,
    repository: createBotOnboardingRepository(options.database),
    newId: randomUUID,
  });
}

/** Transport-free assembly. Database ownership is selected only in repository adapters. */
export function createAuthSessions(options: {
  database: Parameters<typeof createSessionRepository>[0];
  users: UserIdentityPort;
  telegram: TelegramVerifier;
  clock: SessionClock;
  lifetimeSeconds: number;
  signing: SessionSigningOptions;
  ownerAdmission?: OwnerAdmission;
}): AuthSessions {
  return sessionService({
    repository: createSessionRepository(options.database),
    codec: createSessionCodec(options.signing),
    users: options.users,
    telegram: options.telegram,
    clock: options.clock,
    lifetimeSeconds: options.lifetimeSeconds,
    newSessionId: randomUUID,
    ...(options.ownerAdmission ? { ownerAdmission: options.ownerAdmission } : {}),
  });
}

/** Composition entry; imports do not access environment, storage, network, or logs. */
export function createTelegramVerifier(
  botToken: { reveal(): string },
  policy: TelegramVerificationPolicy,
): TelegramVerifier {
  return telegramHmacVerifier(botToken, policy);
}

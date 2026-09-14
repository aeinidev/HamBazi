export { createTelegramVerifier, createAuthSessions } from "./module.js";
export type { AuthSessions, SessionClock, SessionCredential } from "./application/session-ports.js";
export type { SessionContext } from "./domain/session.js";
export type {
  TelegramVerifier,
  TelegramVerificationResult,
} from "./application/telegram-verifier.js";
export type { TelegramIdentity, TelegramVerificationPolicy } from "./domain/telegram-identity.js";
export { createAuthHttpModule, sendRateDecision } from "./infrastructure/http.js";
export { createRedisAuthRateLimiter } from "./infrastructure/redis-rate-limit.js";
export { authOpenApiDocument, authPaths } from "./infrastructure/http-contract.js";
export type { AuthRateLimiter, RateDecision } from "./application/rate-limit.js";

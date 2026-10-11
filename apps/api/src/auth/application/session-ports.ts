import type { ErrorEnvelope } from "@hambazi/contracts";
import type { SessionContext, SessionRecord } from "../domain/session.js";

export interface SessionRepository {
  createOrGet(candidate: SessionRecord): Promise<SessionRecord>;
  find(id: string): Promise<SessionRecord | undefined>;
  revoke(id: string, userId: string, now: number): Promise<void>;
}
export interface SessionCredential {
  reveal(): string;
}
export type SessionClaims = Pick<
  SessionRecord,
  "id" | "userId" | "keyId" | "issuedAt" | "expiresAt" | "issuer" | "audience" | "schemaVersion"
>;
export interface SessionCodec {
  readonly activeKeyId: string;
  readonly issuer: string;
  readonly audience: string;
  sign(record: SessionRecord): Promise<SessionCredential>;
  verify(token: unknown, now: number): Promise<SessionClaims | undefined>;
}
export interface SessionClock {
  nowMs(): number;
}
export type SessionFailure = ErrorEnvelope<
  "UNAUTHENTICATED" | "REGISTRATION_REQUIRED" | "INVALID_INPUT" | "INTERNAL_ERROR"
>;
export interface AuthSessions {
  issue(
    initData: unknown,
    commandId: unknown,
  ): Promise<
    | {
        readonly ok: true;
        readonly session: SessionContext;
        readonly accessToken: SessionCredential;
        readonly photoUrl?: string;
      }
    | SessionFailure
  >;
  authenticate(
    token: unknown,
  ): Promise<{ readonly ok: true; readonly session: SessionContext } | SessionFailure>;
  revoke(token: unknown): Promise<{ readonly ok: true } | SessionFailure>;
}

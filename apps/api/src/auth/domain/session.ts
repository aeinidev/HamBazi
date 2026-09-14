/** Durable non-secret metadata; not a bearer credential. Times are whole Unix seconds. */
export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly commandId: string;
  readonly schemaVersion: number;
  readonly keyId: string;
  readonly issuer: string;
  readonly audience: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
}

export interface SessionContext {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly userId: string;
  readonly expiresAt: number;
}

export function isLiveSession(record: SessionRecord, now: number): boolean {
  return (
    record.schemaVersion === 1 &&
    record.revokedAt === null &&
    Number.isSafeInteger(now) &&
    Number.isSafeInteger(record.issuedAt) &&
    Number.isSafeInteger(record.expiresAt) &&
    record.issuedAt >= 0 &&
    record.issuedAt <= now &&
    record.expiresAt > now
  );
}

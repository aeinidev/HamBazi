import type { AdminGrant } from "../domain/access.js";

export type AdminCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "ADMIN_UNAVAILABLE"
  | "ADMIN_CONFLICT";
export class AdminFault extends Error {
  constructor(readonly code: AdminCode) {
    super(code);
  }
}
export interface AdminOperatorRecord {
  id: string;
  realmId: string;
  username: string;
  passwordVerifier: string;
  pinVerifier: string | null;
  credentialVersion: number;
  sessionEpoch: number;
  authorizationVersion: number;
  status: string;
  pinFailures: number;
  lockedAt: Date | null;
}
export interface AdminRealmRecord {
  id: string;
  ownerId: string | null;
  ownershipEpoch: number;
  policyRevision: number;
}
export interface AdminSessionRecord {
  id: string;
  realmId: string;
  operatorId: string;
  kind: "PENDING" | "FULL";
  credentialVersion: number;
  sessionEpoch: number;
  issuedAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}
export interface AdminReceipt {
  operatorId: string;
  commandId: string;
  digest: string;
  outcome: string;
  sessionId: string | null;
}
export interface AdminAudit {
  id: string;
  realmId: string;
  operatorId: string | null;
  event: string;
  commandId: string;
  occurredAt: Date;
}
export interface AdminTransaction {
  realm(): Promise<AdminRealmRecord | null>;
  operator(id: string): Promise<AdminOperatorRecord | null>;
  session(id: string): Promise<AdminSessionRecord | null>;
  receipt(operatorId: string, commandId: string): Promise<AdminReceipt | null>;
  grants(operatorId: string): Promise<AdminGrant[]>;
  createSession(record: AdminSessionRecord): Promise<void>;
  updateSession(
    id: string,
    patch: Partial<Pick<AdminSessionRecord, "lastSeenAt" | "revokedAt">>,
  ): Promise<void>;
  updateOperator(
    id: string,
    patch: Partial<
      Pick<
        AdminOperatorRecord,
        "pinFailures" | "lockedAt" | "sessionEpoch" | "pinVerifier" | "credentialVersion"
      >
    >,
  ): Promise<void>;
  createOperator(record: AdminOperatorRecord): Promise<void>;
  bindOwner(id: string): Promise<void>;
  advanceOwnership(): Promise<void>;
  createRealm(): Promise<void>;
  saveReceipt(record: AdminReceipt): Promise<void>;
  audit(record: AdminAudit): Promise<void>;
}
export interface AdminRepository {
  findUsername(username: string): Promise<AdminOperatorRecord | null>;
  findSession(id: string): Promise<AdminSessionRecord | null>;
  atomic<T>(operation: (tx: AdminTransaction) => Promise<T>): Promise<T>;
}
export interface AdminCrypto {
  hash(value: string, kind: "password" | "pin"): Promise<string>;
  verify(verifier: string, value: string, kind: "password" | "pin"): Promise<boolean>;
  digest(value: string): string;
  sign(session: AdminSessionRecord): Promise<string>;
  verifyToken(value: unknown): Promise<{ id: string; kind: "PENDING" | "FULL" } | null>;
  csrf(id: string): string;
}
export interface AdminPolicy {
  realmId: string;
  environment: string;
  sessionSeconds: number;
  idleSeconds: number;
  pendingSeconds: number;
  maxCryptoInFlight: number;
}

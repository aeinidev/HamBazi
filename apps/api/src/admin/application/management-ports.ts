import type { AdminAction } from "@hambazi/validation";
import type { AdminGrant } from "../domain/access.js";
import type { AdminOperatorRecord, AdminSessionRecord } from "./ports.js";

export interface AdminRole {
  id: string;
  realmId: string;
  name: string;
  version: number;
  grants: AdminGrant[];
}
export interface AdminOperation {
  id: string;
  realmId: string;
  actorId: string;
  sessionId: string;
  authorizationVersion: number;
  credentialVersion: number;
  sessionEpoch: number;
  policyRevision: number;
  ownershipEpoch: number;
  environment: string;
  digest: string;
  action: AdminAction;
  gameId: string | null;
  reasonCode: string;
  state: "PENDING" | "APPROVED" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
  mode: "OWNER_FINAL" | "DUAL_CONTROL" | null;
  approverId: string | null;
  approverSessionId: string | null;
  approverAuthorizationVersion: number | null;
  approverSessionEpoch: number | null;
  approverCredentialVersion: number | null;
  createdAt: Date;
  expiresAt: Date;
  approvedUntil: Date | null;
  resultCode: string | null;
}
export interface AdminManagementTransaction {
  operators(cursor?: string): Promise<AdminOperatorRecord[]>;
  usernameExists(username: string): Promise<boolean>;
  roles(): Promise<AdminRole[]>;
  roleMemberCounts(): Promise<Record<string, number>>;
  roleIds(operatorId: string): Promise<string[]>;
  directGrants(operatorId: string): Promise<AdminGrant[]>;
  setAccess(operatorId: string, roleIds: string[], grants: AdminGrant[]): Promise<void>;
  saveRole(role: AdminRole): Promise<void>;
  deleteRole(id: string): Promise<void>;
  advancePolicy(): Promise<void>;
  sessions(operatorId: string): Promise<AdminSessionRecord[]>;
  operation(id: string): Promise<AdminOperation | null>;
  saveOperation(value: AdminOperation): Promise<void>;
  operations(actorId?: string): Promise<AdminOperation[]>;
  unknownOperations(cursor?: string): Promise<AdminOperation[]>;
  activity(operatorId: string): Promise<{
    schemaVersion: 1;
    items: {
      id: string;
      operatorId: string | null;
      commandId: string;
      event: string;
      operation: string | null;
      targetId: string | null;
      reasonCode: string | null;
      mode: string | null;
      occurredAt: string;
    }[];
  }>;
}
/** Implemented by each data-owning module; no persistence model crosses this boundary. */
export interface AdminProductPort {
  target(action: AdminAction): Promise<{ gameId: string | null; version: number } | null>;
  execute(operation: Readonly<AdminOperation>): Promise<{ code: string }>;
  outcome(operation: Readonly<AdminOperation>): Promise<{ code: string } | null>;
}

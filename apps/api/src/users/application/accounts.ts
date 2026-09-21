import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import { z } from "zod";
import { handleBase, normalizeDisplayName } from "../domain/account-name.js";

export interface Account {
  readonly schemaVersion: 1;
  readonly userId: string;
  readonly displayName: string;
  readonly publicHandle: string;
}
export interface AccountCreationPort {
  /** Trusted server callers only: validate Telegram authentication before calling. */
  createForVerifiedTelegramIdentity(
    telegramUserId: string,
    displayName: unknown,
  ): Promise<
    | { readonly ok: true; readonly account: Account }
    | ErrorEnvelope<"INVALID_INPUT" | "UNAUTHENTICATED" | "INTERNAL_ERROR">
  >;
}
export interface AccountRecord {
  readonly userId: string;
  readonly displayName: string;
  readonly publicHandle: string;
  readonly status: string;
}
export interface AccountCandidate {
  readonly userId: string;
  readonly telegramUserId: bigint;
  readonly displayName: string;
  readonly publicHandle: string;
}
export interface AccountRepository {
  findByTelegramId(id: bigint): Promise<AccountRecord | undefined>;
  /** Undefined means a UUID/handle collision, never a row belonging to another identity. */
  createOrGet(candidate: AccountCandidate): Promise<AccountRecord | undefined>;
}

export function accountCreationService(deps: {
  repository: AccountRepository;
  newUserId(): string;
  newHandleSuffix(): number;
}): AccountCreationPort {
  function project(row: AccountRecord) {
    if (row.status !== "ACTIVE") return createErrorEnvelope("UNAUTHENTICATED");
    return {
      ok: true as const,
      account: Object.freeze({
        schemaVersion: 1 as const,
        userId: row.userId,
        displayName: row.displayName,
        publicHandle: row.publicHandle,
      }),
    };
  }
  return Object.freeze({
    async createForVerifiedTelegramIdentity(telegramUserId: string, displayName: unknown) {
      try {
        const name = normalizeDisplayName(displayName);
        if (
          typeof telegramUserId !== "string" ||
          !/^[1-9][0-9]{0,18}$/.test(telegramUserId) ||
          name === undefined
        )
          return createErrorEnvelope("INVALID_INPUT");
        const id = BigInt(telegramUserId);
        if (id > 9223372036854775807n) return createErrorEnvelope("INVALID_INPUT");
        const existing = await deps.repository.findByTelegramId(id);
        if (existing) return project(existing);
        const base = handleBase(name);
        for (let attempt = 0; attempt < 5; attempt++) {
          const userId = deps.newUserId();
          const suffix = deps.newHandleSuffix();
          if (
            !z.uuid().safeParse(userId).success ||
            !Number.isInteger(suffix) ||
            suffix < 10000 ||
            suffix > 99999
          )
            return createErrorEnvelope("INTERNAL_ERROR");
          const row = await deps.repository.createOrGet({
            userId: userId.toLowerCase(),
            telegramUserId: id,
            displayName: name,
            publicHandle: `${base}_${suffix}`,
          });
          if (row) return project(row);
        }
        return createErrorEnvelope("INTERNAL_ERROR");
      } catch {
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
  });
}

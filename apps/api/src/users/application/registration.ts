import { createErrorEnvelope } from "@hambazi/contracts";
import type { AccountCreationPort } from "./accounts.js";
import { normalizeDisplayName } from "../domain/account-name.js";
export interface RegistrationProfile {
  userId: string;
  displayName: string;
  completed: boolean;
}
export interface RegistrationRepository {
  read(telegramId: bigint): Promise<RegistrationProfile | undefined>;
  complete(telegramId: bigint, at: number): Promise<RegistrationProfile | undefined>;
}
/** Explicit verified Bot intent only. A technical account never implies registration. */
export function registrationService(deps: {
  repository: RegistrationRepository;
  accounts: AccountCreationPort;
  clock: { nowMs(): number };
}) {
  function id(value: string) {
    if (!/^[1-9][0-9]{0,15}$/.test(value) || BigInt(value) > 9007199254740991n)
      throw new Error("Invalid verified identity");
    return BigInt(value);
  }
  return Object.freeze({
    async read(telegramId: string) {
      return deps.repository.read(id(telegramId));
    },
    async complete(telegramId: string, displayName: string) {
      try {
        const verifiedId = id(telegramId);
        const existing = await deps.repository.read(verifiedId);
        if (!existing) {
          // Telegram names can exceed the existing profile's 40-code-point limit.
          // This projection applies only to new profiles; existing names are preserved.
          const boundedName = [...displayName.normalize("NFC").replace(/ +/g, " ").trim()]
            .slice(0, 40)
            .join("");
          const created = await deps.accounts.createForVerifiedTelegramIdentity(
            telegramId,
            normalizeDisplayName(boundedName) ?? "بازیکن",
          );
          if (!created.ok) return created;
        }
        const at = deps.clock.nowMs();
        if (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000)
          return createErrorEnvelope("INTERNAL_ERROR");
        const profile = await deps.repository.complete(verifiedId, at);
        return profile?.completed
          ? { ok: true as const, profile }
          : createErrorEnvelope("UNAUTHENTICATED");
      } catch {
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
  });
}
export type RegistrationPort = ReturnType<typeof registrationService>;

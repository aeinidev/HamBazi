import { createErrorEnvelope } from "@hambazi/contracts";
import { z } from "zod";
import type {
  Account,
  AccountCreationPort,
  RegistrationPort,
  UserIdentityPort,
} from "../../users/index.js";
import type { SessionClock, SessionFailure } from "./session-ports.js";
import type { TelegramVerifier } from "./telegram-verifier.js";
import type { OwnerAdmission } from "./owner-admission.js";

export interface MiniAppOnboarding {
  create(
    initData: unknown,
    commandId: unknown,
    displayName: unknown,
  ): Promise<
    { readonly ok: true; readonly account: Account; readonly startParam?: string } | SessionFailure
  >;
}

/** Explicit creation intent; never issues a session or grants room membership. */
export function miniAppOnboardingService(deps: {
  registration?: RegistrationPort;
  accounts?: AccountCreationPort;
  users: UserIdentityPort;
  telegram: TelegramVerifier;
  clock: SessionClock;
  ownerAdmission?: OwnerAdmission;
}): MiniAppOnboarding {
  function time() {
    const value = deps.clock.nowMs();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000)
      throw new Error("Invalid server clock");
    return value;
  }
  return Object.freeze({
    async create(initData: unknown, commandId: unknown, displayName: unknown) {
      try {
        if (
          !z.uuid().safeParse(commandId).success ||
          typeof displayName !== "string" ||
          displayName.length > 256
        )
          return createErrorEnvelope("INVALID_INPUT");
        const start = time();
        const verified = deps.telegram.verify(initData, start);
        if (!verified.ok) return createErrorEnvelope("UNAUTHENTICATED");
        const { telegramUserId, startParam } = verified.identity;
        if (deps.ownerAdmission && !(await deps.ownerAdmission.allowsTelegramId(telegramUserId)))
          return createErrorEnvelope("UNAUTHENTICATED");
        // Preserve signed routing data opaquely, bounded by the existing initData transport cap.
        if (startParam !== undefined && startParam.length > 16384)
          return createErrorEnvelope("INVALID_INPUT");
        // Users owns the same completion intent for Bot and direct Mini App entry.
        // Telegram identity uniqueness and the completion guard make retries idempotent.
        const result = deps.registration
          ? await deps.registration.complete(telegramUserId, displayName)
          : await deps.accounts!.createForVerifiedTelegramIdentity(telegramUserId, displayName);
        if (!result.ok) return createErrorEnvelope(result.error.code);
        const account = "profile" in result ? result.profile : result.account;
        const current = await deps.users.findActiveByTelegramId(telegramUserId);
        const end = time();
        const stillVerified = deps.telegram.verify(initData, end);
        if (
          end < start ||
          !current ||
          current.userId !== account.userId ||
          (deps.registration && current.registrationCompleted !== true) ||
          !stillVerified.ok ||
          stillVerified.identity.telegramUserId !== telegramUserId
        )
          return createErrorEnvelope("UNAUTHENTICATED");
        if (deps.ownerAdmission && !(await deps.ownerAdmission.allowsTelegramId(telegramUserId)))
          return createErrorEnvelope("UNAUTHENTICATED");
        // Explicit allowlist; persistence fields cannot leak through a repository/service object.
        return {
          ok: true as const,
          account: Object.freeze({
            schemaVersion: 1 as const,
            userId: account.userId,
            displayName: account.displayName,
            publicHandle: account.publicHandle,
          }),
          ...(startParam !== undefined ? { startParam } : {}),
        };
      } catch {
        // Creation may already have committed. Fresh authenticated retries recover the same account.
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
  });
}

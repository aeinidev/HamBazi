import { z } from "zod";
import { createErrorEnvelope } from "@hambazi/contracts";
import type { BotOnboardingRepository } from "./bot-onboarding-ports.js";
import type { SessionClock } from "./session-ports.js";
export function botCleanupService(
  repository: Pick<BotOnboardingRepository, "cleanup">,
  clock: SessionClock,
) {
  return async (input: unknown) => {
    const parsed = z
      .strictObject({ schemaVersion: z.literal(1), limit: z.number().int().min(1).max(500) })
      .safeParse(input);
    if (!parsed.success) return createErrorEnvelope("INVALID_INPUT");
    try {
      const at = clock.nowMs();
      if (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000) throw new Error();
      return {
        ok: true as const,
        schemaVersion: 1 as const,
        ...(await repository.cleanup(at, parsed.data.limit)),
      };
    } catch {
      return { ok: true as const, schemaVersion: 1 as const, status: "RETRY" as const };
    }
  };
}

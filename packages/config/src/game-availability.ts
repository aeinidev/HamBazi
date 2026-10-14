import { z } from "zod";

/** Reversible admission pause; never changes durable game or match records. */
export function parseGameAvailabilityConfig(env: Readonly<Record<string, string | undefined>>) {
  const paused = z.enum(["true", "false"]).default("true").safeParse(env.COUP_TEMPORARILY_DISABLED);
  if (!paused.success) throw new Error("GAME_AVAILABILITY_CONFIGURATION_INVALID");
  return Object.freeze({ coupTemporarilyDisabled: paused.data === "true" });
}

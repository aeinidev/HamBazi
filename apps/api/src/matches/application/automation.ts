import type { StandardGameResult } from "@hambazi/game-core";
import { z } from "zod";
const counter = z.number().int().min(0).max(2147483647);
export const automationIntentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    matchId: z.uuid(),
    expectedStateVersion: counter,
    expectedRevision: counter,
    deadlineAt: z.number().int().min(0).max(8640000000000000),
    kind: z.enum(["TIMER", "BOT"]),
    playerId: z.uuid().nullable(),
    expectedConnectionEpoch: counter.nullable(),
  })
  .refine((x) =>
    x.kind === "BOT"
      ? x.playerId !== null && x.expectedConnectionEpoch !== null
      : x.playerId === null && x.expectedConnectionEpoch === null,
  );
export type AutomationIntent = z.infer<typeof automationIntentSchema>;
export interface AutomationGame {
  automation(
    snapshot: unknown,
    botIds: readonly string[],
    at: number,
  ): {
    expectedRevision: number;
    deadlineAt: number;
    playerId: string | null;
    kind: "TIMER" | "BOT";
  } | null;
  automate(
    snapshot: unknown,
    intent: AutomationIntent,
    at: number,
  ): {
    state: unknown;
    events: readonly { type: string; schemaVersion: number; payload: unknown }[];
    result: StandardGameResult | null;
  };
}
export const recoveryPageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  after: z.uuid().nullable(),
  limit: z.number().int().min(1).max(100),
});

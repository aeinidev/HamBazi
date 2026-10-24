import { z } from "zod";

export const lobbyAvailabilitySchema = z.array(
  z.strictObject({
    id: z.enum(["kahroba", "hokm", "domino", "chess", "ludo", "coup"]),
    state: z.enum(["AVAILABLE", "COMING_SOON", "TEMPORARILY_DISABLED"]),
  }),
);
export type LobbyAvailability = z.infer<typeof lobbyAvailabilitySchema>;

/** Presentation metadata reflects runtime admission; it cannot grant admission. */
export function lobbyAvailability(
  config: { coupTemporarilyDisabled: boolean },
  personalAdmitted: boolean,
  kahrobaAdmitted = false,
): LobbyAvailability {
  return [
    { id: "kahroba", state: kahrobaAdmitted ? "AVAILABLE" : "COMING_SOON" },
    ...(["hokm", "domino", "chess", "ludo"] as const).map((id) => ({
      id,
      state: "COMING_SOON" as const,
    })),
    {
      id: "coup",
      state: config.coupTemporarilyDisabled
        ? "TEMPORARILY_DISABLED"
        : personalAdmitted
          ? "AVAILABLE"
          : "COMING_SOON",
    },
  ];
}

import { z } from "zod";

export const lobbyAvailabilitySchema = z.array(
  z.strictObject({
    id: z.enum(["kahroba", "hokm", "domino", "chess", "ludo", "coup"]),
    state: z.enum(["AVAILABLE", "COMING_SOON", "TEMPORARILY_DISABLED"]),
  }),
);
export type LobbyAvailability = z.infer<typeof lobbyAvailabilitySchema>;

/** Presentation metadata cannot grant admission. Unreleased games remain dormant. */
export function lobbyAvailability(
  config: { coupTemporarilyDisabled: boolean },
  personalAdmitted: boolean,
): LobbyAvailability {
  return [
    ...(["kahroba", "hokm", "domino", "chess", "ludo"] as const).map((id) => ({
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

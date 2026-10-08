import { parseOwnerAdmissionConfig } from "./owner-admission.js";
/** Explicit temporary profile; ordinary production game activation remains disabled. */
export function parsePersonalGameplayConfig(
  env: Readonly<Record<string, string | undefined>>,
  role: "api" | "worker",
) {
  if (env.PERSONAL_GAMEPLAY_PROFILE === undefined) return undefined;
  if (
    env.PERSONAL_GAMEPLAY_PROFILE !== "owner-bots-v1" ||
    (role === "api" &&
      (!parseOwnerAdmissionConfig(env) || env.ALLOWED_ORIGINS !== "https://staging.hambazi.top"))
  )
    throw new Error("PERSONAL_GAMEPLAY_CONFIGURATION_INVALID");
  return Object.freeze({ profile: "owner-bots-v1" as const, lifetimeMs: 7200000 });
}

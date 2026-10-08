import { expect, it } from "vitest";
import { parsePersonalGameplayConfig } from "../src/index.js";
it("requires explicit paired preparation profile and API owner admission", () => {
  expect(parsePersonalGameplayConfig({}, "api")).toBeUndefined();
  expect(parsePersonalGameplayConfig({}, "worker")).toBeUndefined();
  const env = {
    PERSONAL_GAMEPLAY_PROFILE: "owner-bots-v1",
    AUTH_ADMISSION_POLICY: "telegram-owner-only-v1",
    OWNER_ADMISSION_FILE: "/run/hambazi/owner-admission.json",
    ALLOWED_ORIGINS: "https://staging.hambazi.top",
  };
  expect(parsePersonalGameplayConfig(env, "api")?.lifetimeMs).toBe(7200000);
  expect(parsePersonalGameplayConfig(env, "worker")?.profile).toBe("owner-bots-v1");
  for (const patch of [
    { PERSONAL_GAMEPLAY_PROFILE: "public" },
    { AUTH_ADMISSION_POLICY: undefined },
    { OWNER_ADMISSION_FILE: "/tmp/owner.json" },
    { ALLOWED_ORIGINS: "https://public.invalid" },
  ])
    expect(() => parsePersonalGameplayConfig({ ...env, ...patch }, "api")).toThrow();
});

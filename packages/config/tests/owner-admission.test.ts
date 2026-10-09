import { expect, it } from "vitest";
import { inspect } from "node:util";
import {
  parseOwnerAdmissionConfig,
  parseOwnerAdmissionPolicy,
  parseStagingTestAdmissionPolicy,
  parseStagingTestResolutionConfig,
} from "../src/index.js";

it("requires the complete explicit owner-only pair without accepting a fallback", () => {
  expect(parseOwnerAdmissionConfig({})).toBeUndefined();
  const env = {
    AUTH_ADMISSION_POLICY: "telegram-owner-only-v1",
    OWNER_ADMISSION_FILE: "/run/hambazi/owner-admission.json",
  };
  expect(parseOwnerAdmissionConfig(env)?.profile).toBe("telegram-owner-only-v1");
  for (const patch of [
    { AUTH_ADMISSION_POLICY: undefined },
    { OWNER_ADMISSION_FILE: undefined },
    { AUTH_ADMISSION_POLICY: "off" },
    { OWNER_ADMISSION_FILE: "/tmp/owner.json" },
  ])
    expect(() => parseOwnerAdmissionConfig({ ...env, ...patch })).toThrow(
      "OWNER_ADMISSION_CONFIGURATION_INVALID",
    );
});
it("bounds the staging exception to one numeric ordinary user and requires the owner policy", () => {
  const env = {
    AUTH_ADMISSION_POLICY: "telegram-owner-only-v1",
    OWNER_ADMISSION_FILE: "/run/hambazi/owner-admission.json",
    STAGING_TEST_ADMISSION_FILE: "/run/hambazi/staging-test-admission.json",
    ALLOWED_ORIGINS: "https://staging.hambazi.top",
  };
  expect(parseOwnerAdmissionConfig(env)?.testFile).toBe(env.STAGING_TEST_ADMISSION_FILE);
  for (const patch of [
    { AUTH_ADMISSION_POLICY: undefined },
    { STAGING_TEST_ADMISSION_FILE: "/tmp/test.json" },
    { ALLOWED_ORIGINS: "https://public.example" },
  ])
    expect(() => parseOwnerAdmissionConfig({ ...env, ...patch })).toThrow(
      "OWNER_ADMISSION_CONFIGURATION_INVALID",
    );
  const raw = {
    schemaVersion: 1,
    purpose: "temporary-staging-regular-test-user",
    telegramUserIds: ["43"],
  };
  expect(parseStagingTestAdmissionPolicy(JSON.stringify(raw)).reveal()).toBe("43");
  expect(inspect(parseStagingTestAdmissionPolicy(JSON.stringify(raw)))).not.toContain("43");
  for (const ids of [
    ["devtest98"],
    ["@devtest98"],
    [43],
    ["0"],
    ["043"],
    ["9007199254740992"],
    ["43", "44"],
  ])
    expect(() =>
      parseStagingTestAdmissionPolicy(JSON.stringify({ ...raw, telegramUserIds: ids })),
    ).toThrow("STAGING_TEST_ADMISSION_POLICY_INVALID");
  expect(
    parseStagingTestAdmissionPolicy(JSON.stringify({ ...raw, telegramUserIds: [] })).reveal(),
  ).toBe("");
  expect(() => parseStagingTestAdmissionPolicy(JSON.stringify({ ...raw, admin: true }))).toThrow(
    "STAGING_TEST_ADMISSION_POLICY_INVALID",
  );
});
it("allows temporary identity observation only with an explicit private staging admission reference", () => {
  const env = {
    AUTH_ADMISSION_POLICY: "telegram-owner-only-v1",
    OWNER_ADMISSION_FILE: "/run/hambazi/owner-admission.json",
    STAGING_TEST_ADMISSION_FILE: "/run/hambazi/staging-test-admission.json",
    BOT_MINI_APP_URL: "https://staging.hambazi.top/",
    STAGING_TEST_USER_RESOLUTION: "DevTest98",
  };
  expect(parseStagingTestResolutionConfig(env)?.username).toBe("devtest98");
  expect(parseStagingTestResolutionConfig({})).toBeUndefined();
  for (const patch of [
    { STAGING_TEST_ADMISSION_FILE: undefined },
    { STAGING_TEST_USER_RESOLUTION: "@devtest98" },
    { BOT_MINI_APP_URL: "https://public.example" },
  ])
    expect(() => parseStagingTestResolutionConfig({ ...env, ...patch })).toThrow();
});
it("accepts only one exact private decimal identity and redacts ordinary inspection", () => {
  const raw = { schemaVersion: 1, purpose: "temporary-owner-only", telegramUserIds: ["42424242"] };
  const secret = parseOwnerAdmissionPolicy(JSON.stringify(raw));
  expect(secret.reveal()).toBe("42424242");
  expect(inspect(secret)).not.toContain("42424242");
  expect(JSON.stringify(secret)).not.toContain("42424242");
  for (const ids of [[], ["0"], ["042"], [42], ["-42"], ["9007199254740992"], ["42", "43"]])
    expect(() =>
      parseOwnerAdmissionPolicy(JSON.stringify({ ...raw, telegramUserIds: ids })),
    ).toThrow("OWNER_ADMISSION_POLICY_INVALID");
  for (const value of [
    { ...raw, unknown: true },
    { ...raw, purpose: "fixture" },
    null,
    "private-canary",
    raw,
  ])
    expect(() =>
      parseOwnerAdmissionPolicy(
        typeof value === "string" ? value : JSON.stringify({ ...value, schemaVersion: 2 }),
      ),
    ).toThrow("OWNER_ADMISSION_POLICY_INVALID");
});

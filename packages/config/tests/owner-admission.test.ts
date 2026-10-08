import { expect, it } from "vitest";
import { inspect } from "node:util";
import { parseOwnerAdmissionConfig, parseOwnerAdmissionPolicy } from "../src/index.js";

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

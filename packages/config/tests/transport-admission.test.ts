import { expect, it } from "vitest";
import { parseTransportAdmissionConfig, transportAdmissionPolicySchema } from "../src/index.js";
const env = {
  ADMISSION_HTTP_PER_MINUTE: "60",
  ADMISSION_ENGINE_PER_MINUTE: "120",
  ADMISSION_CONNECT_PER_MINUTE: "10",
  ADMISSION_EVENT_PER_MINUTE: "120",
  ADMISSION_HTTP_IN_FLIGHT: "8",
  ADMISSION_ENGINE_IN_FLIGHT: "8",
  ADMISSION_CONNECTIONS: "16",
  ADMISSION_PENDING_PER_SOCKET: "4",
  ADMISSION_PENDING_TOTAL: "32",
  ADMISSION_SUBSCRIPTIONS: "3",
};
it("requires a full explicit profile in production without inferring quotas", () => {
  expect(parseTransportAdmissionConfig({})).toBeUndefined();
  expect(() => parseTransportAdmissionConfig({ NODE_ENV: "production" })).toThrow(
    "Transport admission configuration is invalid",
  );
  expect(parseTransportAdmissionConfig({ ...env, NODE_ENV: "production" })).toMatchObject({
    maxSubscriptions: 3,
  });
  expect(Object.isFrozen(parseTransportAdmissionConfig(env))).toBe(true);
});
it.each(Object.keys(env))(
  "rejects missing or malformed %s without disclosing its value",
  (name) => {
    for (const value of [
      undefined,
      "",
      "0",
      "-1",
      "1.5",
      "Infinity",
      "1000001",
      "private-config-material",
    ])
      expect(() => parseTransportAdmissionConfig({ ...env, [name]: value })).toThrow(
        "Transport admission configuration is invalid",
      );
  },
);
it("rejects inconsistent work bounds and extra runtime policy fields", () => {
  expect(() => parseTransportAdmissionConfig({ ...env, ADMISSION_PENDING_TOTAL: "3" })).toThrow();
  expect(
    transportAdmissionPolicySchema.safeParse({ ...parseTransportAdmissionConfig(env), unknown: 1 })
      .success,
  ).toBe(false);
});

import { expect, it } from "vitest";
import { parseKahrobaRuntimeConfig } from "../src/index.js";
const local = {
  NODE_ENV: "test",
  API_DATABASE_URL: "postgres://api:synthetic@127.0.0.1:5432/owned",
  API_REDIS_URL: "redis://api:synthetic@127.0.0.1:6379/0",
  API_BIND_ADDRESS: "127.0.0.1",
  ALLOWED_ORIGINS: "http://127.0.0.1:4193",
  KAHROBA_RUNTIME_PROFILE: "local-private-v1",
  KAHROBA_ENGINE_REGISTERED: "true",
  KAHROBA_RUNTIME_ENABLED: "true",
  KAHROBA_ROUTES_ENABLED: "true",
  KAHROBA_ADMISSION_ENABLED: "true",
  KAHROBA_QUEUE_NAMESPACE: "isolated-k4a",
  KAHROBA_RECONNECT_LEASE_MS: "30000",
  KAHROBA_RECONNECT_GRACE_MS: "30000",
  KAHROBA_LOCAL_ADMISSION_FILE: "/tmp/owned/admission.json",
};
it("is dormant without explicit flags and supports separate admission shutoff", () => {
  expect(parseKahrobaRuntimeConfig({}, "api")).toBeUndefined();
  expect(
    parseKahrobaRuntimeConfig({ ...local, KAHROBA_ADMISSION_ENABLED: "false" }, "api"),
  ).toMatchObject({
    registered: true,
    enabled: true,
    routes: true,
    admission: false,
    maxPlayers: 4,
  });
});
it.each([
  { NODE_ENV: "production" },
  { API_BIND_ADDRESS: "0.0.0.0" },
  { ALLOWED_ORIGINS: "https://staging.hambazi.top" },
  { API_DATABASE_URL: "postgres://api:synthetic@database/owned" },
  { KAHROBA_ENGINE_REGISTERED: "false" },
  { KAHROBA_RUNTIME_ENABLED: "false" },
  { KAHROBA_ROUTES_ENABLED: "false" },
  { KAHROBA_LOCAL_ADMISSION_FILE: "relative" },
  { AUTH_ADMISSION_POLICY: "telegram-owner-only-v1" },
])("rejects an unsafe local configuration %j", (change) =>
  expect(() => parseKahrobaRuntimeConfig({ ...local, ...change }, "api")).toThrow(
    "KAHROBA_RUNTIME_CONFIGURATION_INVALID",
  ),
);
it("restricted staging requires the existing exact owner/tester policy with two-to-four-seat engine support", () => {
  const stage = {
    ...local,
    NODE_ENV: "production",
    PERSONAL_GAMEPLAY_PROFILE: "owner-bots-v1",
    KAHROBA_RUNTIME_PROFILE: "restricted-staging-v1",
    AUTH_ADMISSION_POLICY: "telegram-owner-only-v1",
    OWNER_ADMISSION_FILE: "/run/hambazi/owner-admission.json",
    STAGING_TEST_ADMISSION_FILE: "/run/hambazi/staging-test-admission.json",
    ALLOWED_ORIGINS: "https://staging.hambazi.top",
    KAHROBA_LOCAL_ADMISSION_FILE: undefined,
  };
  expect(parseKahrobaRuntimeConfig(stage, "api")).toMatchObject({ local: false, maxPlayers: 4 });
  expect(() =>
    parseKahrobaRuntimeConfig({ ...stage, STAGING_TEST_ADMISSION_FILE: undefined }, "api"),
  ).toThrow();
  expect(() =>
    parseKahrobaRuntimeConfig({ ...stage, KAHROBA_LOCAL_ADMISSION_FILE: "/tmp/alternate" }, "api"),
  ).toThrow();
});
it("requires v1/v2 consumers and matching queue namespace on Worker", () => {
  const worker = {
    ...local,
    WORKER_DATABASE_URL: local.API_DATABASE_URL,
    WORKER_REDIS_URL: local.API_REDIS_URL,
    WORKER_QUEUE_NAMESPACE: "isolated-k4a",
    STATS_ENABLED: "true",
    MATCH_OUTBOX_ENABLED: "true",
  };
  expect(parseKahrobaRuntimeConfig(worker, "worker")).toBeDefined();
  expect(() =>
    parseKahrobaRuntimeConfig({ ...worker, STATS_ENABLED: "false" }, "worker"),
  ).toThrow();
  expect(() =>
    parseKahrobaRuntimeConfig({ ...worker, WORKER_QUEUE_NAMESPACE: "foreign" }, "worker"),
  ).toThrow();
});

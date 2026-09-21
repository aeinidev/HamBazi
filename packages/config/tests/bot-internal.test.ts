import { describe, expect, it } from "vitest";
import { parseBotInternalConfig, parseOnboardingWorkerConfig } from "../src/index.js";
const env = {
  BOT_INTERNAL_ENABLED: "true",
  BOT_INTERNAL_BIND_ADDRESS: "127.0.0.1",
  BOT_INTERNAL_PORT: "9443",
  API_PORT: "3000",
  BOT_INTERNAL_TLS_KEY_FILE: "/run/secrets/key.pem",
  BOT_INTERNAL_TLS_CERT_FILE: "/run/secrets/cert.pem",
  BOT_INTERNAL_REQUEST_LIMIT: "60",
  BOT_INTERNAL_IDENTITY_LIMIT: "6",
  BOT_ONBOARDING_LEASE_MS: "10000",
};
const worker = {
  WORKER_QUEUE_NAMESPACE: "test",
  BOT_CLEANUP_INTERVAL_MS: "1000",
  BOT_CLEANUP_BATCH_SIZE: "25",
  BOT_CLEANUP_ATTEMPTS: "3",
  BOT_CLEANUP_BACKOFF_MS: "100",
  WORKER_DB_POOL_MAX: "2",
};
describe("private listener configuration", () => {
  it("is opt-in and immutable", () => {
    expect(parseBotInternalConfig({})).toBeUndefined();
    expect(parseBotInternalConfig({ BOT_INTERNAL_ENABLED: "false" })).toBeUndefined();
    expect(Object.isFrozen(parseBotInternalConfig(env))).toBe(true);
  });
  it.each(["0.0.0.0", "::", "8.8.8.8", "localhost", "::1%lo"])(
    "rejects unsafe bind %s",
    (address) =>
      expect(() => parseBotInternalConfig({ ...env, BOT_INTERNAL_BIND_ADDRESS: address })).toThrow(
        "configuration is invalid",
      ),
  );
  it.each(["127.0.0.1", "10.2.3.4", "192.168.1.1", "172.16.0.1", "::1", "fd00::1"])(
    "permits private bind %s",
    (address) =>
      expect(
        parseBotInternalConfig({ ...env, BOT_INTERNAL_BIND_ADDRESS: address })?.bindAddress,
      ).toBe(address),
  );
  it.each([
    ["BOT_INTERNAL_ENABLED", "1"],
    ["BOT_INTERNAL_PORT", "3000"],
    ["BOT_INTERNAL_PORT", "65536"],
    ["BOT_INTERNAL_PORT", "0"],
    ["BOT_INTERNAL_REQUEST_LIMIT", "301"],
    ["BOT_INTERNAL_IDENTITY_LIMIT", "31"],
    ["BOT_ONBOARDING_LEASE_MS", "999"],
    ["BOT_ONBOARDING_LEASE_MS", "60001"],
    ["BOT_INTERNAL_TLS_KEY_FILE", "relative"],
    ["BOT_INTERNAL_TLS_CERT_FILE", "/secret\nvalue"],
  ])("rejects invalid %s", (key, value) =>
    expect(() => parseBotInternalConfig({ ...env, [key]: value })).toThrow(
      "configuration is invalid",
    ),
  );
  it.each(Object.keys(env).filter((key) => !["API_PORT", "BOT_INTERNAL_ENABLED"].includes(key)))(
    "requires %s when enabled",
    (key) =>
      expect(() => parseBotInternalConfig({ ...env, [key]: undefined })).toThrow(
        "configuration is invalid",
      ),
  );
});
describe("explicit cleanup configuration", () => {
  it("parses immutable bounded settings", () =>
    expect(parseOnboardingWorkerConfig(worker)).toEqual({
      namespace: "test",
      intervalMs: 1000,
      batchSize: 25,
      attempts: 3,
      backoffMs: 100,
      poolMax: 2,
    }));
  it.each(Object.keys(worker))("requires %s", (key) =>
    expect(() => parseOnboardingWorkerConfig({ ...worker, [key]: undefined })).toThrow(
      "configuration is invalid",
    ),
  );
  it.each([
    ["WORKER_QUEUE_NAMESPACE", "with:separator"],
    ["BOT_CLEANUP_INTERVAL_MS", "999"],
    ["BOT_CLEANUP_INTERVAL_MS", "3600001"],
    ["BOT_CLEANUP_BATCH_SIZE", "501"],
    ["BOT_CLEANUP_BATCH_SIZE", "0"],
    ["BOT_CLEANUP_ATTEMPTS", "6"],
    ["BOT_CLEANUP_BACKOFF_MS", "0"],
    ["WORKER_DB_POOL_MAX", "21"],
  ])("rejects invalid %s", (key, value) =>
    expect(() => parseOnboardingWorkerConfig({ ...worker, [key]: value })).toThrow(
      "configuration is invalid",
    ),
  );
});

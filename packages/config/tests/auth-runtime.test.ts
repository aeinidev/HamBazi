import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { parseAuthRuntimeConfig } from "../src/index.js";
const environment = {
  TELEGRAM_BOT_TOKEN: `123:${"a".repeat(32)}`,
  AUTH_SESSION_SECONDS: "900",
  AUTH_TELEGRAM_MAX_AGE_SECONDS: "300",
  AUTH_TELEGRAM_FUTURE_SKEW_SECONDS: "30",
  AUTH_IP_LIMIT: "30",
  AUTH_IDENTITY_LIMIT: "6",
  AUTH_ACTIVE_KEY_ID: "key-1",
  AUTH_ISSUER: "hambazi:test",
  AUTH_AUDIENCE: "mini-app:test",
  AUTH_SIGNING_KEYS: JSON.stringify([
    { id: "key-1", secret: Buffer.alloc(32, 7).toString("base64url") },
  ]),
  API_TRUSTED_PROXIES: "",
  API_BIND_ADDRESS: "127.0.0.1",
  API_DB_POOL_MAX: "5",
};
describe("explicit auth runtime policy", () => {
  it("rejects signing with the bot credential's bytes", () => {
    expect(() =>
      parseAuthRuntimeConfig({
        ...environment,
        AUTH_SIGNING_KEYS: JSON.stringify([
          {
            id: "key-1",
            secret: Buffer.from(environment.TELEGRAM_BOT_TOKEN, "utf8").toString("base64url"),
          },
        ]),
      }),
    ).toThrow("Authentication configuration is invalid");
  });
  it("accepts approved settings, redacts secrets and freezes collections", () => {
    const config = parseAuthRuntimeConfig(environment);
    expect(config.lifetimeSeconds).toBe(900);
    expect(config.telegram).toEqual({
      maxAgeSeconds: 300,
      maxFutureSkewSeconds: 30,
      maxBytes: 16384,
      maxFields: 32,
    });
    expect(config.trustedProxies).toEqual([]);
    expect(Object.isFrozen(config.signing.keys)).toBe(true);
    for (const serialized of [JSON.stringify(config), inspect(config, { depth: 8 })]) {
      expect(serialized).not.toContain(environment.TELEGRAM_BOT_TOKEN);
      expect(serialized).not.toContain(Buffer.alloc(32, 7).toString("base64url"));
    }
  });
  it.each(Object.keys(environment))("requires %s explicitly", (key) => {
    expect(() => parseAuthRuntimeConfig({ ...environment, [key]: undefined })).toThrow(
      "Authentication configuration is invalid",
    );
  });
  it.each([
    ["AUTH_SESSION_SECONDS", "59"],
    ["AUTH_SESSION_SECONDS", "1801"],
    ["AUTH_SESSION_SECONDS", "1e3"],
    ["AUTH_TELEGRAM_MAX_AGE_SECONDS", "601"],
    ["AUTH_TELEGRAM_MAX_AGE_SECONDS", "29"],
    ["AUTH_TELEGRAM_FUTURE_SKEW_SECONDS", "31"],
    ["AUTH_TELEGRAM_FUTURE_SKEW_SECONDS", "-1"],
    ["AUTH_IP_LIMIT", "0"],
    ["AUTH_IP_LIMIT", "301"],
    ["AUTH_IDENTITY_LIMIT", "31"],
    ["AUTH_ACTIVE_KEY_ID", "unknown"],
    ["AUTH_SIGNING_KEYS", "secret-not-json"],
    ["AUTH_ISSUER", "bad issuer"],
    ["AUTH_AUDIENCE", ""],
    ["API_DB_POOL_MAX", "101"],
    ["API_TRUSTED_PROXIES", "true"],
    ["API_TRUSTED_PROXIES", "1"],
    ["API_TRUSTED_PROXIES", "0.0.0.0/0"],
    ["API_TRUSTED_PROXIES", "::/0"],
    ["API_TRUSTED_PROXIES", "127.0.0.1/33"],
    ["API_BIND_ADDRESS", "example.org"],
  ])("rejects unsafe %s=%s", (key, value) => {
    expect(() => parseAuthRuntimeConfig({ ...environment, [key]: value })).toThrow(
      "Authentication configuration is invalid",
    );
  });
  it("accepts explicit proxy ranges and duration boundaries", () => {
    expect(
      parseAuthRuntimeConfig({
        ...environment,
        API_TRUSTED_PROXIES: "127.0.0.1,10.0.0.0/8,::1/128",
        AUTH_SESSION_SECONDS: "1800",
        AUTH_TELEGRAM_FUTURE_SKEW_SECONDS: "0",
      }).trustedProxies,
    ).toHaveLength(3);
  });
  it.each([
    [],
    [{ id: "key-1", secret: "x" }],
    [
      { id: "key-1", secret: Buffer.alloc(32).toString("base64url") },
      { id: "key-1", secret: Buffer.alloc(32, 1).toString("base64url") },
    ],
    [
      { id: "key-1", secret: Buffer.alloc(32).toString("base64url") },
      { id: "key-2", secret: Buffer.alloc(32).toString("base64url") },
    ],
  ])("rejects invalid key sets without exposing rejected input", (...keys) => {
    expect(() =>
      parseAuthRuntimeConfig({ ...environment, AUTH_SIGNING_KEYS: JSON.stringify(keys) }),
    ).toThrow();
  });
});

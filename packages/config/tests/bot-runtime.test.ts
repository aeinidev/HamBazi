import { describe, it, expect } from "vitest";
import { inspect } from "node:util";
import { parseBotRuntimeConfig } from "../src/index.js";
const env = {
  NODE_ENV: "test",
  TELEGRAM_BOT_TOKEN: `123:${"a".repeat(32)}`,
  TELEGRAM_BOT_USERNAME: "hambazi_test_bot",
  TELEGRAM_WEBHOOK_SECRET: "w".repeat(40),
  BOT_SERVICE_KEY_ID: "current",
  BOT_SERVICE_KEY: Buffer.alloc(32, 17).toString("base64url"),
  BOT_API_ORIGIN: "https://127.0.0.1:9443",
  BOT_BIND_ADDRESS: "127.0.0.1",
  BOT_PORT: "8443",
  BOT_TLS_KEY_FILE: "/run/secrets/key",
  BOT_TLS_CERT_FILE: "/run/secrets/cert",
  BOT_MINI_APP_URL: "https://mini.example/app",
  BOT_BACKEND_TIMEOUT_MS: "2000",
  BOT_SEND_TIMEOUT_MS: "3000",
  BOT_ONBOARDING_LEASE_MS: "15000",
  BOT_MAX_IN_FLIGHT: "8",
};
describe("Bot-only runtime settings", () => {
  it("parses without DB, Redis, or session keys and redacts credentials", () => {
    const config = parseBotRuntimeConfig(env);
    expect(config.botId).toBe("123");
    expect(config.requestTimeoutMs).toBe(10000);
    expect(Object.isFrozen(config)).toBe(true);
    for (const text of [inspect(config), JSON.stringify(config)])
      for (const secret of [
        env.TELEGRAM_BOT_TOKEN,
        env.TELEGRAM_WEBHOOK_SECRET,
        env.BOT_SERVICE_KEY,
      ])
        expect(text).not.toContain(secret);
  });
  it.each(Object.keys(env))("requires %s", (key) =>
    expect(() => parseBotRuntimeConfig({ ...env, [key]: undefined })).toThrow(
      "Bot runtime configuration is invalid",
    ),
  );
  it.each([
    "http://127.0.0.1",
    "https://api.example",
    "https://8.8.8.8",
    "https://127.0.0.1/path",
    "https://127.0.0.1?x=1",
    "https://secret@127.0.0.1",
    "https://127.0.0.1/#hash",
  ])("rejects unbounded backend origin %s", (url) =>
    expect(() => parseBotRuntimeConfig({ ...env, BOT_API_ORIGIN: url })).toThrow(),
  );
  it.each([
    ["BOT_BIND_ADDRESS", "0.0.0.0"],
    ["BOT_PORT", "0"],
    ["BOT_PORT", "65536"],
    ["BOT_BACKEND_TIMEOUT_MS", "5001"],
    ["BOT_SEND_TIMEOUT_MS", "0"],
    ["BOT_ONBOARDING_LEASE_MS", "7000"],
    ["BOT_MAX_IN_FLIGHT", "101"],
    ["BOT_TLS_KEY_FILE", "relative"],
    ["BOT_API_CA_FILE", "relative"],
    ["BOT_SERVICE_KEY", "invalid"],
    ["BOT_SERVICE_KEY", Buffer.alloc(32, 17).toString("base64url") + "="],
    ["BOT_MINI_APP_URL", "http://mini.example"],
    ["TELEGRAM_BOT_USERNAME", "othername"],
    ["TELEGRAM_BOT_TOKEN", `9999999999999999:${"a".repeat(32)}`],
  ])("rejects invalid %s", (key, value) =>
    expect(() => parseBotRuntimeConfig({ ...env, [key]: value })).toThrow(),
  );
  it("rejects webhook/service secret reuse", () =>
    expect(() =>
      parseBotRuntimeConfig({ ...env, BOT_SERVICE_KEY: env.TELEGRAM_WEBHOOK_SECRET }),
    ).toThrow());
  it("enables the relay only as a complete, redacted pair", () => {
    const key = "p".repeat(43);
    const config = parseBotRuntimeConfig({
      ...env,
      TELEGRAM_API_PROXY_URL: "https://relay.example/",
      TELEGRAM_API_PROXY_KEY: key,
    });
    expect(config.telegramProxy?.origin).toBe("https://relay.example");
    expect(config.telegramProxy?.key.reveal()).toBe(key);
    expect(JSON.stringify(config)).not.toContain(key);
    expect(inspect(config)).not.toContain(key);
    expect(parseBotRuntimeConfig(env).telegramProxy).toBeUndefined();
    for (const values of [
      { TELEGRAM_API_PROXY_URL: "https://relay.example" },
      { TELEGRAM_API_PROXY_KEY: key },
      { TELEGRAM_API_PROXY_URL: "https://relay.example", TELEGRAM_API_PROXY_KEY: "short" },
      {
        TELEGRAM_API_PROXY_URL: "https://relay.example",
        TELEGRAM_API_PROXY_KEY: env.BOT_SERVICE_KEY,
      },
    ])
      expect(() => parseBotRuntimeConfig({ ...env, ...values })).toThrow();
  });
  it.each([
    "http://relay.example",
    "https://relay.example/v1",
    "https://relay.example?token=x",
    "https://user:secret@relay.example",
    "https://127.0.0.1",
    "https://relay.local",
    "https://relay.example:8443",
    "https://relay.example/#fragment",
  ])("rejects unsafe relay target %s", (target) => {
    expect(() =>
      parseBotRuntimeConfig({
        ...env,
        TELEGRAM_API_PROXY_URL: target,
        TELEGRAM_API_PROXY_KEY: "p".repeat(43),
      }),
    ).toThrow();
  });
});

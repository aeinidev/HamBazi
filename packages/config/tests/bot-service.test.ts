import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { parseBotServiceConfig } from "../src/index.js";

const secret = Buffer.alloc(32, 17).toString("base64url");
const previous = Buffer.alloc(64, 18).toString("base64url");
const signingSecret = Buffer.alloc(32, 19).toString("base64url");
const environment = {
  TELEGRAM_BOT_TOKEN: `123:${"a".repeat(32)}`,
  AUTH_SESSION_SECONDS: "900",
  AUTH_TELEGRAM_MAX_AGE_SECONDS: "300",
  AUTH_TELEGRAM_FUTURE_SKEW_SECONDS: "30",
  AUTH_IP_LIMIT: "30",
  AUTH_IDENTITY_LIMIT: "6",
  AUTH_ACTIVE_KEY_ID: "session",
  AUTH_ISSUER: "test",
  AUTH_AUDIENCE: "mini-app",
  AUTH_SIGNING_KEYS: JSON.stringify([{ id: "session", secret: signingSecret }]),
  API_TRUSTED_PROXIES: "",
  API_BIND_ADDRESS: "127.0.0.1",
  API_DB_POOL_MAX: "5",
  BOT_SERVICE_ACTIVE_KEY_ID: "current",
  BOT_SERVICE_KEYS: JSON.stringify([
    { id: "current", secret },
    { id: "previous", secret: previous },
  ]),
  BOT_SERVICE_ALLOWED_PEERS: "127.0.0.1,10.2.3.4,172.16.1.2,192.168.1.3,::1,fd00::1",
  TELEGRAM_WEBHOOK_SECRET: "w".repeat(40),
};

describe("Bot service verifier configuration", () => {
  it("validates and freezes a two-key rotation snapshot without exposing credentials", () => {
    const config = parseBotServiceConfig(environment);
    expect(config.botId).toBe("123");
    expect(config.activeKeyId).toBe("current");
    expect(config.keys).toHaveLength(2);
    expect(config.keys[0]!.secret.reveal()).toBe(secret);
    for (const value of [config, config.keys, config.keys[0], config.allowedPeers])
      expect(Object.isFrozen(value)).toBe(true);
    for (const value of [JSON.stringify(config), inspect(config, { depth: 8 })]) {
      for (const sensitive of [
        secret,
        previous,
        signingSecret,
        environment.TELEGRAM_BOT_TOKEN,
        environment.TELEGRAM_WEBHOOK_SECRET,
      ])
        expect(value).not.toContain(sensitive);
    }
  });
  it.each([
    "BOT_SERVICE_ACTIVE_KEY_ID",
    "BOT_SERVICE_KEYS",
    "BOT_SERVICE_ALLOWED_PEERS",
    "TELEGRAM_WEBHOOK_SECRET",
  ])("requires %s", (field) => {
    expect(() => parseBotServiceConfig({ ...environment, [field]: undefined })).toThrow(
      "Bot service configuration is invalid",
    );
  });
  it.each([
    "",
    "0.0.0.0",
    "::",
    "8.8.8.8",
    "169.254.1.1",
    "172.32.1.1",
    "100.64.1.1",
    "2001:4860::8888",
    "10.0.0.0/8",
    "localhost",
    "127.0.0.1,",
    "127.0.0.1, 10.0.0.1",
    "fe80::1%lo",
    Array(33).fill("127.0.0.1").join(","),
  ])("rejects unsafe peer list %s", (peers) => {
    expect(() =>
      parseBotServiceConfig({ ...environment, BOT_SERVICE_ALLOWED_PEERS: peers }),
    ).toThrow("Bot service configuration is invalid");
  });
  it("accepts a mapped loopback address but rejects a mapped public address", () => {
    expect(
      parseBotServiceConfig({ ...environment, BOT_SERVICE_ALLOWED_PEERS: "::ffff:127.0.0.1" })
        .allowedPeers,
    ).toHaveLength(1);
    expect(() =>
      parseBotServiceConfig({ ...environment, BOT_SERVICE_ALLOWED_PEERS: "::ffff:8.8.8.8" }),
    ).toThrow();
  });
  it.each([
    "not-json",
    "[]",
    JSON.stringify([{ id: "current", secret: "x" }]),
    JSON.stringify([{ id: "missing", secret }]),
    JSON.stringify([
      { id: "current", secret },
      { id: "current", secret: previous },
    ]),
    JSON.stringify([
      { id: "current", secret },
      { id: "previous", secret },
    ]),
    JSON.stringify([
      { id: "current", secret },
      { id: "previous", secret: previous },
      { id: "third", secret: signingSecret },
    ]),
    ...[31, 65].map((n) =>
      JSON.stringify([{ id: "current", secret: Buffer.alloc(n).toString("base64url") }]),
    ),
    JSON.stringify([{ id: "current", secret: `${secret}=` }]),
    JSON.stringify([{ id: "current", secret, scope: "admin" }]),
    ...[
      signingSecret,
      Buffer.from(signingSecret).toString("base64url"),
      Buffer.from(environment.TELEGRAM_BOT_TOKEN).toString("base64url"),
      environment.TELEGRAM_WEBHOOK_SECRET,
      Buffer.from(environment.TELEGRAM_WEBHOOK_SECRET).toString("base64url"),
    ].map((reused) => JSON.stringify([{ id: "current", secret: reused }])),
  ])("rejects malformed, excessive or reused keys (case %#) safely", (keys) => {
    try {
      parseBotServiceConfig({ ...environment, BOT_SERVICE_KEYS: keys });
      expect.fail("accepted invalid configuration");
    } catch (error) {
      expect(error).toMatchObject({
        code: "INVALID_CONFIGURATION",
        message: "Bot service configuration is invalid",
      });
      expect(inspect(error)).not.toContain(secret);
      expect(inspect(error)).not.toContain(keys);
      expect(error).not.toHaveProperty("cause");
    }
  });
});

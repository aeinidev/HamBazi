import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { ConfigurationError, parseRuntimeConfig, SecretValue } from "../src/index.js";

const valid = {
  NODE_ENV: "development",
  API_DATABASE_URL: "postgresql://api:synthetic-pass@localhost:5432/hambazi",
  WORKER_DATABASE_URL: "postgresql://worker:other-pass@localhost:5432/hambazi",
  API_REDIS_URL: "redis://api:synthetic-pass@localhost:6379/0",
  WORKER_REDIS_URL: "redis://worker:other-pass@localhost:6379/0",
  API_PORT: "3000",
  ALLOWED_ORIGINS: "http://localhost:5173,http://localhost:5173/",
};

describe("runtime configuration", () => {
  it("parses API fields, canonicalizes origins, and strips unrelated environment", () => {
    const input = { ...valid, BOT_TOKEN: "unrelated-secret" };
    const config = parseRuntimeConfig(input, "api");
    expect(config.role).toBe("api");
    if (config.role !== "api") throw new Error("Unexpected role");
    expect(config.port).toBe(3000);
    expect(config.allowedOrigins).toEqual(["http://localhost:5173"]);
    expect("BOT_TOKEN" in config).toBe(false);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.allowedOrigins)).toBe(true);
    expect(input).toEqual({ ...valid, BOT_TOKEN: "unrelated-secret" });
  });

  it("requires only the selected worker credentials, without API settings", () => {
    const config = parseRuntimeConfig(
      {
        NODE_ENV: "test",
        WORKER_DATABASE_URL: valid.WORKER_DATABASE_URL,
        WORKER_REDIS_URL: valid.WORKER_REDIS_URL,
      },
      "worker",
    );
    expect(config.databaseUrl.reveal() === valid.WORKER_DATABASE_URL).toBe(true);
    expect(config.redisUrl.reveal() === valid.WORKER_REDIS_URL).toBe(true);
    expect("port" in config).toBe(false);
  });

  it.each(["NODE_ENV", "API_DATABASE_URL", "API_REDIS_URL", "API_PORT", "ALLOWED_ORIGINS"])(
    "rejects missing %s with a safe field name",
    (field) => {
      try {
        parseRuntimeConfig({ ...valid, [field]: undefined }, "api");
        throw new Error("Expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as ConfigurationError).fields).toContain(field);
      }
    },
  );

  it.each([
    ["NODE_ENV", "preview"],
    ["API_PORT", ""],
    ["API_PORT", "0"],
    ["API_PORT", "65536"],
    ["API_PORT", "3.5"],
    ["API_PORT", "1e3"],
    ["API_DATABASE_URL", "https://api:pw@host/db"],
    ["API_DATABASE_URL", "postgres://host/db"],
    ["API_DATABASE_URL", "postgres://api:pw@host/"],
    ["API_DATABASE_URL", "postgres://api:REPLACE_PASSWORD@host/db"],
    ["API_DATABASE_URL", "postgres://api:pw@host:70000/db"],
    ["API_REDIS_URL", "redis://host:6379"],
    ["API_REDIS_URL", "redis://api:pw@host/not-a-number"],
    ["ALLOWED_ORIGINS", "*"],
    ["ALLOWED_ORIGINS", ""],
    ["ALLOWED_ORIGINS", "http://localhost/path"],
    ["ALLOWED_ORIGINS", "http://user:password@localhost"],
    ["ALLOWED_ORIGINS", "https://example.com?q=1"],
  ])("rejects invalid %s input", (field, value) => {
    expect(() => parseRuntimeConfig({ ...valid, [field]: value }, "api")).toThrow(
      ConfigurationError,
    );
  });

  it("requires explicit encrypted endpoints and HTTPS origins in production", () => {
    expect(() => parseRuntimeConfig({ ...valid, NODE_ENV: "production" }, "api")).toThrow(
      ConfigurationError,
    );
    const config = parseRuntimeConfig(
      {
        ...valid,
        NODE_ENV: "production",
        API_DATABASE_URL: valid.API_DATABASE_URL + "?sslmode=require",
        API_REDIS_URL: valid.API_REDIS_URL.replace("redis:", "rediss:"),
        ALLOWED_ORIGINS: "https://app.example.com",
      },
      "api",
    );
    expect(config.environment).toBe("production");
  });

  it("rejects conflicting production TLS options", () => {
    expect(() =>
      parseRuntimeConfig(
        {
          NODE_ENV: "production",
          WORKER_DATABASE_URL: valid.WORKER_DATABASE_URL + "?sslmode=require&sslmode=disable",
          WORKER_REDIS_URL: valid.WORKER_REDIS_URL.replace("redis:", "rediss:"),
        },
        "worker",
      ),
    ).toThrow(ConfigurationError);
  });

  it("validates worker credentials independently of valid API credentials", () => {
    expect(() =>
      parseRuntimeConfig({ ...valid, WORKER_DATABASE_URL: "invalid" }, "worker"),
    ).toThrow(ConfigurationError);
    expect(() => parseRuntimeConfig({ ...valid, WORKER_REDIS_URL: undefined }, "worker")).toThrow(
      ConfigurationError,
    );
  });

  it("redacts credentials in strings, JSON, inspection, and validation failures", () => {
    const sentinel = "SYNTHETIC_SECRET_SENTINEL";
    const config = parseRuntimeConfig(
      { ...valid, API_DATABASE_URL: `postgres://api:${sentinel}@host/db` },
      "api",
    );
    for (const rendered of [JSON.stringify(config), inspect(config), String(config.databaseUrl)])
      expect(rendered.includes(sentinel)).toBe(false);
    const secret = new SecretValue(sentinel);
    expect(secret.reveal() === sentinel).toBe(true);
    try {
      parseRuntimeConfig(
        { ...valid, API_DATABASE_URL: sentinel, ALLOWED_ORIGINS: sentinel },
        "api",
      );
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      for (const rendered of [JSON.stringify(error), inspect(error), String(error)])
        expect(rendered.includes(sentinel)).toBe(false);
      expect((error as ConfigurationError).code).toBe("INVALID_CONFIGURATION");
    }
  });
});

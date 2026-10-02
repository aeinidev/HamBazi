import { expect, it } from "vitest";
import { parseTelemetryConfig } from "../src/index.js";
it("disables exports until explicit role-scoped configuration and protects the DSN", () => {
  expect(parseTelemetryConfig({}, "api")).toEqual({ metricsEnabled: false, sentryDsn: undefined });
  const dsn = `https://${"a".repeat(32)}@approved.example/42`;
  const config = parseTelemetryConfig(
    {
      API_METRICS_ENABLED: "true",
      API_HEALTH_PORT: "9090",
      API_SENTRY_DSN: dsn,
      BOT_SENTRY_DSN: "PRIVATE",
    },
    "api",
  );
  expect(config.metricsEnabled).toBe(true);
  expect(config.sentryDsn?.reveal()).toBe(dsn);
  expect(JSON.stringify(config)).not.toContain(dsn);
  expect(String(config.sentryDsn)).toBe("[REDACTED]");
});
it.each([
  { API_METRICS_ENABLED: "PRIVATE" },
  { API_METRICS_ENABLED: "true" },
  { API_SENTRY_DSN: "PRIVATE" },
  { API_SENTRY_DSN: "http://PRIVATE" },
])("sanitizes invalid telemetry configuration %#", (env) => {
  try {
    parseTelemetryConfig(env, "api");
    throw new Error("Expected rejection");
  } catch (error) {
    expect(error).toMatchObject({ code: "INVALID_CONFIGURATION" });
    expect(JSON.stringify(error)).not.toContain("PRIVATE");
  }
});

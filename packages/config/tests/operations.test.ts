import { expect, it } from "vitest";
import { parseOperationsConfig } from "../src/index.js";
it("keeps health disabled and preserves each prior supervisor budget", () => {
  expect(parseOperationsConfig({}, "api")).toEqual({
    port: undefined,
    probeTimeoutMs: 1000,
    drainTimeoutMs: 15000,
  });
  expect(parseOperationsConfig({}, "bot").drainTimeoutMs).toBe(30000);
});
it("projects only bounded role-specific operational inputs", () => {
  expect(
    parseOperationsConfig(
      {
        API_HEALTH_PORT: "9090",
        API_HEALTH_PROBE_TIMEOUT_MS: "200",
        API_DRAIN_TIMEOUT_MS: "60000",
        BOT_HEALTH_PORT: "SECRET",
      },
      "api",
    ),
  ).toEqual({ port: 9090, probeTimeoutMs: 200, drainTimeoutMs: 60000 });
});
it.each(["API_HEALTH_PORT", "API_HEALTH_PROBE_TIMEOUT_MS", "API_DRAIN_TIMEOUT_MS"])(
  "sanitizes invalid %s",
  (field) => {
    for (const value of ["0", "-1", "1.5", " 1000", "Infinity", "9999999", "PRIVATE_TOKEN"]) {
      try {
        parseOperationsConfig({ [field]: value }, "api");
        throw new Error("Expected failure");
      } catch (error) {
        expect(error).toMatchObject({ code: "INVALID_CONFIGURATION", fields: [field] });
        expect(JSON.stringify(error)).not.toContain(value);
      }
    }
  },
);

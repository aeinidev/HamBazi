import { expect, it } from "vitest";
import { parseStatisticsConfig } from "../src/index.js";
it("leaves statistics off by omission and requires explicit worker settings", () => {
  expect(parseStatisticsConfig({}, "api")).toBeUndefined();
  expect(parseStatisticsConfig({ STATS_ENABLED: "false" }, "worker")).toBeUndefined();
  expect(parseStatisticsConfig({ STATS_ENABLED: "true" }, "api")).toEqual({ enabled: true });
  expect(() => parseStatisticsConfig({ STATS_ENABLED: "true" }, "worker")).toThrow();
  expect(() => parseStatisticsConfig({ STATS_CONCURRENCY: "1" }, "worker")).toThrow();
  expect(
    parseStatisticsConfig(
      { STATS_ENABLED: "true", STATS_CONCURRENCY: "2", STATS_DRAIN_TIMEOUT_MS: "5000" },
      "worker",
    ),
  ).toEqual({ enabled: true, concurrency: 2, drainTimeoutMs: 5000 });
  for (const value of ["0", "17", "oops"])
    expect(() =>
      parseStatisticsConfig(
        { STATS_ENABLED: "true", STATS_CONCURRENCY: value, STATS_DRAIN_TIMEOUT_MS: "5000" },
        "worker",
      ),
    ).toThrow();
});

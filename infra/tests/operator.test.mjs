import { expect, it } from "vitest";
import {
  createMetrics,
  telemetryEvents,
  metricGauges,
  metricCollectors,
} from "../../packages/observability/dist/index.js";
import { projectOperatorLogs, projectOperatorMetrics } from "../release/monitoring.mjs";

it("projects only existing safe events and fields, excluding raw crash output and sensitive payloads", () => {
  const canary = "PRIVATE_GAMEPLAY_AND_SECRET_CANARY";
  const logs = [
    JSON.stringify({ level: 30, event: "api.started", token: canary, state: canary, msg: canary }),
    JSON.stringify({
      level: 40,
      event: "worker.failed",
      errorCode: "INTERNAL_ERROR",
      error: canary,
    }),
    JSON.stringify({ level: 30, event: canary }),
    canary,
  ].join("\n");
  const result = projectOperatorLogs(logs);
  expect(result).toEqual({
    records: [
      { level: 30, event: "api.started" },
      { level: 40, event: "worker.failed", errorCode: "INTERNAL_ERROR" },
    ],
    omitted: 2,
  });
  expect(JSON.stringify(result)).not.toContain(canary);
  expect(projectOperatorLogs(Array(250).fill(logs.split("\n")[0]).join("\n")).records).toHaveLength(
    200,
  );
});

it("accepts real fixed-dimension metrics including failed collection and denies injected dimensions/content", () => {
  for (const role of ["api", "bot", "worker"]) {
    const metrics = createMetrics(role);
    telemetryEvents.forEach((event) => metrics.emit(event, { durationMs: 10 }));
    metricGauges.forEach((name) => metrics.gauge(name, 0));
    metricCollectors.forEach((name) => metrics.collection(name, false));
    metrics.dependency("postgres", false, 10);
    metrics.drain("failed", 10);
    metrics.report("dropped");
    expect(projectOperatorMetrics(metrics.render(), role)).toBe(metrics.render());
  }
  for (const text of [
    'hambazi_admitting{service="api",user_id="PRIVATE_CANARY"} 1\n',
    'hambazi_admitting{service="bot"} 1\n',
    'hambazi_admitting{service="api",service="api"} 1\n',
    'hambazi_admitting{service="api"} NaN\n',
    'hambazi_admitting{service="api"} -1\n',
    "# HELP PRIVATE_CANARY\n",
    'hambazi_hidden_state{service="api"} 1\n',
  ])
    expect(() => projectOperatorMetrics(text, "api")).toThrow("OPERATOR_OBSERVATION_INVALID");
});

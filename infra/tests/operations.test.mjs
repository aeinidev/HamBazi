import { readFile, access } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  createMetrics,
  metricGauges,
  metricCollectors,
  telemetryEvents,
} from "../../packages/observability/src/index.js";
const root = new URL("../../", import.meta.url);
const read = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
it("references real bounded metrics and existing runbooks with explicit unresolved alert gates", async () => {
  const dashboard = await read("docs/operations/dashboard.json"),
    definitions = await read("docs/operations/alerts.json");
  const metrics = createMetrics("api");
  metricGauges.forEach((name) => metrics.gauge(name, 0));
  metricCollectors.forEach((name) => metrics.collection(name, true));
  telemetryEvents.forEach((event) => metrics.emit(event, { durationMs: 10 }));
  metrics.dependency("postgres", true, 10);
  metrics.drain("completed", 10);
  metrics.report("sent");
  const names = new Set(
    [...metrics.render().matchAll(/^hambazi_([a-z_]+)/gm)].map((m) => `hambazi_${m[1]}`),
  );
  for (const query of [
    ...dashboard.panels.map((p) => p.query),
    ...definitions.alerts.map((a) => a.signal),
  ])
    for (const [name] of query.matchAll(/hambazi_[a-z_]+/g))
      expect(names.has(name), name).toBe(true);
  expect(new Set(dashboard.panels.map((p) => p.id)).size).toBe(dashboard.panels.length);
  expect(new Set(definitions.alerts.map((a) => a.id)).size).toBe(definitions.alerts.length);
  for (const alert of definitions.alerts) {
    expect(alert.owner.length).toBeGreaterThan(0);
    expect(["SEV1", "SEV2"]).toContain(alert.severity);
    expect(alert.routingEnabled).toBe(false);
    expect(alert.cooldownSeconds).toBeGreaterThan(0);
    expect(alert.persistenceSeconds).toBeNull();
    if (alert.thresholdDecision) {
      expect(alert.thresholdDecision).toBe("OD-007");
      expect(alert.threshold).toBeNull();
    }
    await access(new URL(`docs/operations/${alert.runbook}`, root));
  }
  expect(dashboard.sloBurn).toMatchObject({ decision: "OD-007", objective: null, window: null });
  expect(dashboard.deploymentAnnotations.phase).toBe("18B");
});

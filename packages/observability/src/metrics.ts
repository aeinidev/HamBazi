import { ERROR_CODES } from "@hambazi/shared";
import { ownValue } from "./correlation.js";
import { telemetryEvents, telemetryFields, type TelemetryEvent } from "./logger.js";

export type ServiceRole = "api" | "bot" | "worker";
import { metricOperations } from "./vocabulary.js";
export { metricOperations } from "./vocabulary.js";
export const metricGauges = Object.freeze([
  "sockets",
  "connected_users",
  "db_pool_total",
  "db_pool_idle",
  "db_pool_waiting",
  "db_pool_max",
  "matches_created",
  "matches_waiting",
  "matches_ready",
  "matches_starting",
  "matches_active",
  "matches_started",
  "matches_finished",
  "matches_terminated",
  "players_disconnected",
  "players_bot",
  "disconnects_recorded",
  "reconnects_recorded",
  "bot_takeovers_recorded",
  "rooms_waiting",
  "rooms_full",
  "rooms_starting",
  "rooms_started",
  "rooms_closed",
  "rooms_expired",
  "admissions_searching",
  "admissions_reserved",
  "admissions_oldest_wait_seconds",
  "outbox_pending",
  "outbox_failed",
  "outbox_oldest_pending_seconds",
  "queue_waiting",
  "queue_active",
  "queue_delayed",
  "queue_failed",
] as const);
export type MetricGauge = (typeof metricGauges)[number];
export const metricCollectors = Object.freeze([
  "database",
  "matches",
  "admissions",
  "rooms",
  "outbox",
  "queues",
] as const);
export type MetricCollector = (typeof metricCollectors)[number];
export type DependencyName = "postgres" | "redis" | "backend";
const buckets = [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2, 5, 15, 60] as const;
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const clamp = (v: number) => Math.min(v, Number.MAX_SAFE_INTEGER);
type Histogram = { sum: number; count: number; buckets: number[] };
const histogram = (): Histogram => ({ sum: 0, count: 0, buckets: buckets.map(() => 0) });
function observe(h: Histogram, seconds: number) {
  h.sum = clamp(h.sum + seconds);
  h.count = clamp(h.count + 1);
  buckets.forEach((b, i) => {
    if (seconds <= b) h.buckets[i] = clamp(h.buckets[i]! + 1);
  });
}
/** All series keys are selected from fixed code-owned enums. IDs/content never become dimensions. */
export function createMetrics(service: ServiceRole) {
  if (!["api", "bot", "worker"].includes(service)) throw new Error("Invalid metrics role");
  const events = new Map<string, number>();
  const durations = new Map<string, Histogram>();
  const gauges = new Map<MetricGauge, number>();
  const collectors = new Map<MetricCollector, number>();
  const dependencies = new Map<DependencyName, { available: number; duration: Histogram }>();
  const drains = new Map<"completed" | "failed", Histogram>();
  const reports = new Map<"sent" | "failed" | "dropped", number>();
  let admitting = 0;
  const labels = (extra = "") => `{service="${service}"${extra}}`;
  return Object.freeze({
    emit(event: TelemetryEvent, fields?: unknown) {
      if (!telemetryEvents.some((e) => e === event)) return;
      const safe = telemetryFields(fields);
      const supplied = ownValue(fields, "operation");
      const operation = metricOperations.find((v) => v === supplied) ?? "other";
      const code = ERROR_CODES.find((v) => v === safe.errorCode) ?? "NONE";
      const key = `,event="${event}",operation="${operation}",error_code="${code}"`;
      events.set(key, clamp((events.get(key) ?? 0) + 1));
      if (finite(safe.durationMs)) {
        const durationKey = `,event="${event}",operation="${operation}"`;
        const h = durations.get(durationKey) ?? histogram();
        observe(h, safe.durationMs / 1000);
        durations.set(durationKey, h);
      }
    },
    gauge(name: MetricGauge, value: unknown) {
      if (metricGauges.some((v) => v === name) && finite(value)) gauges.set(name, value);
    },
    collection(name: MetricCollector, success: boolean) {
      if (metricCollectors.some((v) => v === name)) collectors.set(name, success === true ? 1 : 0);
    },
    admission(value: boolean) {
      admitting = value === true ? 1 : 0;
    },
    dependency(name: DependencyName, available: boolean, durationMs: number) {
      if (!["postgres", "redis", "backend"].includes(name) || !finite(durationMs)) return;
      const row = dependencies.get(name) ?? { available: 0, duration: histogram() };
      row.available = available === true ? 1 : 0;
      observe(row.duration, durationMs / 1000);
      dependencies.set(name, row);
    },
    drain(result: "completed" | "failed", durationMs: number) {
      if (!["completed", "failed"].includes(result) || !finite(durationMs)) return;
      const h = drains.get(result) ?? histogram();
      observe(h, durationMs / 1000);
      drains.set(result, h);
    },
    report(result: "sent" | "failed" | "dropped") {
      if (["sent", "failed", "dropped"].includes(result))
        reports.set(result, clamp((reports.get(result) ?? 0) + 1));
    },
    render() {
      const lines: string[] = [];
      const type = (name: string, kind: string) => lines.push(`# TYPE hambazi_${name} ${kind}`);
      const sample = (name: string, value: number, extra = "") =>
        lines.push(`hambazi_${name}${labels(extra)} ${value}`);
      const hist = (name: string, h: Histogram, extra: string) => {
        buckets.forEach((b, i) => sample(`${name}_bucket`, h.buckets[i]!, `${extra},le="${b}"`));
        sample(`${name}_bucket`, h.count, `${extra},le="+Inf"`);
        sample(`${name}_sum`, h.sum, extra);
        sample(`${name}_count`, h.count, extra);
      };
      type("events_total", "counter");
      for (const [k, v] of [...events].sort()) sample("events_total", v, k);
      type("duration_seconds", "histogram");
      for (const [k, h] of [...durations].sort()) hist("duration_seconds", h, k);
      type("admitting", "gauge");
      sample("admitting", admitting);
      for (const name of metricGauges)
        if (gauges.has(name)) {
          type(name, "gauge");
          sample(name, gauges.get(name)!);
        }
      type("collection_success", "gauge");
      for (const [name, v] of [...collectors].sort())
        sample("collection_success", v, `,collector="${name}"`);
      type("dependency_available", "gauge");
      for (const [name, row] of [...dependencies].sort())
        sample("dependency_available", row.available, `,dependency="${name}"`);
      type("dependency_probe_seconds", "histogram");
      for (const [name, row] of [...dependencies].sort())
        hist("dependency_probe_seconds", row.duration, `,dependency="${name}"`);
      type("drain_seconds", "histogram");
      for (const [result, h] of [...drains].sort()) hist("drain_seconds", h, `,result="${result}"`);
      type("reports_total", "counter");
      for (const [result, v] of [...reports].sort())
        sample("reports_total", v, `,result="${result}"`);
      return lines.join("\n") + "\n";
    },
  });
}
export type OperationalMetrics = ReturnType<typeof createMetrics>;

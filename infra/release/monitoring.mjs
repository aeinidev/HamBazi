import {
  telemetryEvents,
  telemetryFields,
  metricGauges,
  metricCollectors,
  metricOperations,
} from "../../packages/observability/dist/index.js";
import { ERROR_CODES } from "../../packages/shared/dist/index.js";

export const operatorProfile = "private-manual-v1";
export const operatorLogging = Object.freeze({
  driver: "local",
  options: { "max-size": "10m", "max-file": "3", compress: "true" },
});
const invalid = () => {
  throw new Error("OPERATOR_OBSERVATION_INVALID");
};

/** Reuse the application allowlist; raw stderr, messages and unknown fields never leave this tool. */
export function projectOperatorLogs(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 1024 * 1024) invalid();
  const records = [];
  let omitted = 0;
  for (const line of text.split("\n").filter(Boolean).slice(-200)) {
    try {
      if (Buffer.byteLength(line) > 4096) throw new Error();
      const row = JSON.parse(line);
      if (!telemetryEvents.includes(row?.event) || ![30, 40].includes(row.level)) throw new Error();
      const traceparent =
        /^[a-f0-9]{32}$/.test(row.traceId ?? "") && /^[a-f0-9]{16}$/.test(row.spanId ?? "")
          ? `00-${row.traceId}-${row.spanId}-01`
          : undefined;
      records.push({
        level: row.level,
        event: row.event,
        ...telemetryFields({ ...row, traceparent }),
      });
    } catch {
      omitted++;
    }
  }
  return { records, omitted };
}

const histogram = (name) => [name, `${name}_bucket`, `${name}_sum`, `${name}_count`];
const names = new Set([
  ...metricGauges,
  "events_total",
  "admitting",
  "collection_success",
  "dependency_available",
  "reports_total",
  ...histogram("duration_seconds"),
  ...histogram("dependency_probe_seconds"),
  ...histogram("drain_seconds"),
]);
/** Validate fixed code-owned dimensions before displaying an operational scrape. */
export function projectOperatorMetrics(text, role) {
  if (
    !["api", "bot", "worker"].includes(role) ||
    typeof text !== "string" ||
    Buffer.byteLength(text) > 65536
  )
    invalid();
  const domains = {
    service: [role],
    event: telemetryEvents,
    operation: metricOperations,
    error_code: [...ERROR_CODES, "NONE"],
    collector: metricCollectors,
    dependency: ["postgres", "redis", "backend"],
    result: ["completed", "failed", "sent", "dropped"],
    le: ["0.005", "0.025", "0.1", "0.25", "0.5", "1", "2", "5", "15", "60", "+Inf"],
  };
  let samples = 0;
  for (const line of text.split("\n").filter(Boolean)) {
    const type = /^# TYPE hambazi_([a-z_]+) (counter|histogram|gauge)$/.exec(line);
    if (type) {
      if (!names.has(type[1])) invalid();
      continue;
    }
    const sample = /^hambazi_([a-z_]+)\{([^}]+)\} ([0-9.eE+-]+)$/.exec(line);
    if (!sample || !names.has(sample[1]) || !Number.isFinite(+sample[3]) || +sample[3] < 0)
      invalid();
    const labels = [...sample[2].matchAll(/([a-z_]+)="([^"\\]*)"/g)];
    if (
      labels.map((m) => m[0]).join(",") !== sample[2] ||
      new Set(labels.map((m) => m[1])).size !== labels.length ||
      !labels.some((m) => m[1] === "service" && m[2] === role) ||
      labels.some((m) => !domains[m[1]]?.includes(m[2]))
    )
      invalid();
    samples++;
  }
  if (!samples) invalid();
  return text;
}

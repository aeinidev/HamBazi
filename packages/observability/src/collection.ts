import { withDeadline } from "./health.js";
import { ownValue } from "./correlation.js";
import {
  metricGauges,
  type MetricCollector,
  type MetricGauge,
  type OperationalMetrics,
} from "./metrics.js";
/** Bounded/coalesced aggregate reads. Failed samples retain gauges with an explicit invalid flag. */
export function createMetricCollection(
  metrics: OperationalMetrics,
  sources: readonly {
    name: MetricCollector;
    read(): Promise<Partial<Record<MetricGauge, number>>>;
  }[],
  timeoutMs: number,
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new Error("Invalid metrics collection budget");
  const slots = sources.map((source) => {
    let active: Promise<Partial<Record<MetricGauge, number>>> | undefined;
    let result: Promise<void> | undefined;
    return () => {
      if (!active) {
        active = Promise.resolve().then(() => source.read());
        const work = active;
        result = withDeadline(work, timeoutMs).then(
          (values) => {
            try {
              const names = Object.getOwnPropertyNames(values);
              const samples: [MetricGauge, number][] = [];
              for (const name of names) {
                const known = metricGauges.find((n) => n === name);
                const value = ownValue(values, name);
                if (
                  !known ||
                  typeof value !== "number" ||
                  !Number.isFinite(value) ||
                  value < 0 ||
                  value > Number.MAX_SAFE_INTEGER
                )
                  throw new Error("Invalid diagnostic sample");
                samples.push([known, value]);
              }
              if (!samples.length) throw new Error("Invalid diagnostic sample");
              for (const [name, value] of samples) metrics.gauge(name, value);
              metrics.collection(source.name, true);
            } catch {
              metrics.collection(source.name, false);
            }
          },
          () => {
            metrics.collection(source.name, false);
          },
        );
        void work.then(
          () => {
            if (active === work) active = undefined;
          },
          () => {
            if (active === work) active = undefined;
          },
        );
      }
      return result!;
    };
  });
  return async () => {
    await Promise.all(slots.map((read) => read()));
  };
}

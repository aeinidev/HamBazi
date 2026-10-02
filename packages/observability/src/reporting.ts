import { randomUUID } from "node:crypto";
import { request } from "node:https";
import { telemetryEvents, telemetryFields, type TelemetryEvent } from "./logger.js";
import type { OperationalMetrics, ServiceRole } from "./metrics.js";

const reportable = new Set<TelemetryEvent>([
  "api.failed",
  "bot.failed",
  "worker.failed",
  "http.completed",
  "socket.completed",
  "bot.webhook_completed",
  "realtime.delivery_failed",
  "worker.job_failed",
  "worker.domain_failed",
  "worker.outbox_failed",
  "worker.statistics_maintenance_failed",
]);
export function sentryTarget(dsn: string) {
  try {
    const url = new URL(dsn);
    if (
      url.protocol !== "https:" ||
      !/^[a-f0-9]{32}$/.test(url.username) ||
      url.password ||
      !/^\/[1-9][0-9]{0,19}$/.test(url.pathname) ||
      url.search ||
      url.hash ||
      !url.hostname
    )
      throw new Error();
    return Object.freeze({ dsn: url.href, endpoint: `${url.origin}/api${url.pathname}/envelope/` });
  } catch {
    throw new Error("Invalid reporting configuration");
  }
}
/** Explicit safe envelope only. No SDK integrations, request capture, breadcrumbs, stacks or traces. */
export function createSentryTransport(dsn: { reveal(): string }, ca?: string | Buffer) {
  const target = sentryTarget(dsn.reveal());
  return async (event: Readonly<Record<string, unknown>>): Promise<void> => {
    // The reporter owns this literal payload; transport is never an application capture API.
    const payload = JSON.stringify(event);
    const body =
      JSON.stringify({ event_id: event.event_id, dsn: target.dsn }) +
      "\n" +
      JSON.stringify({ type: "event", length: Buffer.byteLength(payload) }) +
      "\n" +
      payload +
      "\n";
    await new Promise<void>((resolve, reject) => {
      const req = request(
        target.endpoint,
        {
          method: "POST",
          agent: false,
          signal: AbortSignal.timeout(2000),
          headers: {
            "Content-Type": "application/x-sentry-envelope",
            "Content-Length": Buffer.byteLength(body),
          },
          ...(ca ? { ca } : {}),
        },
        (res) => {
          // Discard all server response content. Fail closed on redirects/rate limits/errors.
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error("Reporting unavailable"));
        },
      );
      req.on("error", () => reject(new Error("Reporting unavailable")));
      req.end(body);
    });
  };
}
export function createSafeReporter(options: {
  service: ServiceRole;
  send(event: Readonly<Record<string, unknown>>): Promise<void>;
  metrics: OperationalMetrics;
}) {
  if (!["api", "bot", "worker"].includes(options.service))
    throw new Error("Invalid reporting role");
  let active: Promise<void> | undefined;
  const last = new Map<TelemetryEvent, number>();
  let stopped = false;
  return Object.freeze({
    emit(event: TelemetryEvent, fields?: unknown) {
      if (stopped || !telemetryEvents.some((v) => v === event) || !reportable.has(event)) return;
      const safe = telemetryFields(fields);
      const lifecycleFailure =
        event === "api.failed" || event === "bot.failed" || event === "worker.failed";
      const code = safe.errorCode ?? (lifecycleFailure ? "INTERNAL_ERROR" : undefined);
      if (code !== "INTERNAL_ERROR" && !event.endsWith("_failed")) return;
      const now = performance.now();
      if (active || now - (last.get(event) ?? -Infinity) < 60000) {
        options.metrics.report("dropped");
        return;
      }
      last.set(event, now);
      const payload = Object.freeze({
        event_id: randomUUID().replaceAll("-", ""),
        timestamp: Date.now() / 1000,
        platform: "node",
        level: "error",
        logger: "hambazi.safe",
        message: event,
        fingerprint: Object.freeze([
          "hambazi",
          options.service,
          event,
          String(code ?? "INTERNAL_ERROR"),
        ]),
        tags: Object.freeze({
          service: options.service,
          event,
          error_code: code ?? "INTERNAL_ERROR",
        }),
      });
      active = Promise.resolve()
        .then(() => options.send(payload))
        .then(
          () => options.metrics.report("sent"),
          () => options.metrics.report("failed"),
        )
        .finally(() => {
          active = undefined;
        });
    },
    async close() {
      stopped = true;
      await active;
    },
  });
}

import { createServer } from "node:http";
import type { DependencyName, OperationalMetrics } from "./metrics.js";
export const healthPaths = Object.freeze({ live: "/v1/health/live", ready: "/v1/health/ready" });
export const metricsPath = "/v1/metrics";
export type HealthStatus = "LIVE" | "READY" | "DEGRADED" | "NOT_READY";
export interface HealthSnapshot {
  readonly schemaVersion: 1;
  readonly status: HealthStatus;
}
export interface HealthCheck {
  readonly name?: DependencyName;
  readonly required: boolean;
  probe(signal: AbortSignal): Promise<boolean>;
}
export async function withDeadline<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Operation deadline exceeded")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/** At most one underlying probe per dependency, even if an adapter ignores cancellation. */
export function createServiceHealth(
  checks: readonly HealthCheck[],
  timeoutMs: number,
  metrics?: OperationalMetrics,
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new Error("Invalid health probe timeout");
  let state: "STARTING" | "READY" | "DRAINING" | "STOPPED" = "STARTING";
  const probes = checks.map((check) => {
    let active: Promise<boolean> | undefined;
    let result: Promise<boolean> | undefined;
    return {
      required: check.required,
      probe() {
        if (!active) {
          const controller = new AbortController();
          const started = performance.now();
          active = Promise.resolve()
            .then(() => check.probe(controller.signal))
            .then(
              (v) => v === true,
              () => false,
            );
          const work = active;
          result = withDeadline(work, timeoutMs)
            .catch(() => {
              controller.abort();
              return false;
            })
            .then((available) => {
              if (check.name)
                metrics?.dependency(check.name, available, performance.now() - started);
              return available;
            });
          void work.finally(() => {
            if (active === work) active = undefined;
          });
        }
        return result!;
      },
    };
  });
  const snapshot = (status: HealthStatus): HealthSnapshot =>
    Object.freeze({ schemaVersion: 1, status });
  return Object.freeze({
    started() {
      if (state === "STARTING") state = "READY";
      metrics?.admission(state === "READY");
    },
    stopAdmission() {
      if (state !== "STOPPED") state = "DRAINING";
      metrics?.admission(false);
    },
    stopped() {
      state = "STOPPED";
      metrics?.admission(false);
    },
    accepting: () => state === "READY",
    // Process liveness remains independent of application admission/dependency state.
    live: () => snapshot("LIVE"),
    async ready(): Promise<HealthSnapshot> {
      if (state !== "READY") return snapshot("NOT_READY");
      const values = await Promise.all(probes.map((p) => p.probe()));
      if (state !== "READY" || values.some((v, i) => !v && probes[i]!.required))
        return snapshot("NOT_READY");
      return snapshot(values.every(Boolean) ? "READY" : "DEGRADED");
    },
  });
}
export type ServiceHealth = ReturnType<typeof createServiceHealth>;
/** Separate loopback-only operational listener; never mount on product ingress. */
export async function startHealthServer(
  health: ServiceHealth,
  port: number,
  observation?: {
    metrics: OperationalMetrics;
    collect?(): Promise<void>;
  },
) {
  const server = createServer(
    { maxHeaderSize: 4096, requestTimeout: 5000, headersTimeout: 5000, keepAliveTimeout: 1000 },
    (request, response) => {
      const send = (code: number, body: HealthSnapshot) => {
        response.writeHead(code, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        });
        response.end(JSON.stringify({ schemaVersion: 1, status: body.status }));
      };
      if (
        request.method !== "GET" ||
        (request.url !== healthPaths.live &&
          request.url !== healthPaths.ready &&
          !(observation && request.url === metricsPath)) ||
        request.headers.host !== `127.0.0.1:${(server.address() as { port: number }).port}` ||
        Object.keys(request.headers).some(
          (k) => k === "origin" || k === "forwarded" || k.startsWith("x-forwarded-"),
        )
      ) {
        send(404, { schemaVersion: 1, status: "NOT_READY" });
        return;
      }
      if (request.url === metricsPath && observation) {
        void Promise.all([health.ready(), observation.collect?.()]).then(
          () => {
            response.writeHead(200, {
              "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            });
            response.end(observation.metrics.render());
          },
          () => send(503, { schemaVersion: 1, status: "NOT_READY" }),
        );
        return;
      }
      const work =
        request.url === healthPaths.live ? Promise.resolve(health.live()) : health.ready();
      void work.then(
        (body) => send(body.status === "NOT_READY" ? 503 : 200, body),
        () => send(503, { schemaVersion: 1, status: "NOT_READY" }),
      );
    },
  );
  server.maxRequestsPerSocket = 100;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  let closing: Promise<void> | undefined;
  return Object.freeze({
    port: (server.address() as { port: number }).port,
    close: () =>
      (closing ??= new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(new Error("Health listener close failed")) : resolve())),
      )),
  });
}

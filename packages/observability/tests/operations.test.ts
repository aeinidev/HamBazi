import { randomUUID } from "node:crypto";
import { createServer } from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  createMetrics,
  createMetricCollection,
  createServiceHealth,
  createSafeReporter,
  createTelemetryLogger,
  startHealthServer,
} from "../src/index.js";
import { createSentryTransport, sentryTarget } from "../src/reporting.js";
const tick = () => new Promise((r) => setImmediate(r));
it("sends a valid safe envelope over verified TLS and bounds an unresponsive receiver", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-reporting-test-"));
  const keyPath = join(directory, "key.pem"),
    certPath = join(directory, "cert.pem");
  await promisify(execFile)("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
  const key = await readFile(keyPath),
    cert = await readFile(certPath);
  const received: string[] = [];
  let respond = true;
  const server = createServer({ key, cert }, (req, res) => {
    expect(req.url).toBe("/api/42/envelope/");
    expect(req.headers["content-type"]).toBe("application/x-sentry-envelope");
    let body = "";
    req.on("data", (v) => {
      body += v;
    });
    req.on("end", () => {
      received.push(body);
      if (respond) res.end("PRIVATE_SERVER_CONTENT");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const dsn = { reveal: () => `https://${"a".repeat(32)}@127.0.0.1:${port}/42` };
  const metrics = createMetrics("api");
  try {
    const reporter = createSafeReporter({
      service: "api",
      metrics,
      send: createSentryTransport(dsn, cert),
    });
    reporter.emit("http.completed", {
      errorCode: "INTERNAL_ERROR",
      chat: "PRIVATE_CHAT",
      state: "PRIVATE_STATE",
      token: "PRIVATE_TOKEN",
      userId: randomUUID(),
    });
    await reporter.close();
    expect(received).toHaveLength(1);
    const [envelope, item, event] = received[0]!.trim().split("\n");
    expect(JSON.parse(envelope!).event_id).toBe(JSON.parse(event!).event_id);
    expect(JSON.parse(item!)).toEqual({ type: "event", length: Buffer.byteLength(event!) });
    expect(received[0]).not.toMatch(/PRIVATE|userId|headers|traceId|state/);
    expect(metrics.render()).toContain('result="sent"} 1');
    respond = false;
    const failing = createSafeReporter({
      service: "api",
      metrics,
      send: createSentryTransport(dsn, cert),
    });
    const started = performance.now();
    failing.emit("api.failed");
    await failing.close();
    expect(performance.now() - started).toBeLessThan(3000);
    expect(metrics.render()).toContain('result="failed"} 1');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(directory, { recursive: true, force: true });
  }
});
it("exports fixed dimensions and cumulative histograms without identity, content or executable properties", () => {
  const metrics = createMetrics("api");
  const getter = vi.fn(() => "PRIVATE");
  const hostile = Object.create({ operation: "PRIVATE" });
  Object.defineProperty(hostile, "errorCode", { get: getter });
  metrics.emit("socket.completed", hostile);
  for (let i = 0; i < 100; i++)
    metrics.emit("socket.completed", {
      operation: "command",
      durationMs: 100,
      userId: randomUUID(),
      errorCode: "GAME_STATE_CONFLICT",
      state: "PRIVATE",
      token: "PRIVATE",
    });
  metrics.emit("PRIVATE" as never);
  metrics.gauge("PRIVATE" as never, 1);
  metrics.gauge("sockets", Infinity);
  const output = metrics.render();
  expect(output).not.toContain("PRIVATE");
  expect(output).not.toMatch(/userId|stateVersion|traceId|matchId/);
  expect(getter).not.toHaveBeenCalled();
  expect(output).toContain('error_code="GAME_STATE_CONFLICT"} 100');
  expect(output).toContain('operation="command",le="0.025"} 0');
  expect(output).toContain('operation="command",le="0.1"} 100');
  expect(output).toContain('operation="command",le="+Inf"} 100');
  expect(output.match(/^hambazi_events_total/gm)).toHaveLength(2);
});
it("projects before every observer and survives a failed logger destination", () => {
  const observer = vi.fn();
  const logger = createTelemetryLogger(
    {
      write() {
        throw new Error("PRIVATE");
      },
    },
    { emit: observer },
  );
  logger.emit("api.failed", { headers: "PRIVATE", message: "PRIVATE" });
  expect(observer).toHaveBeenCalledWith("api.failed", { event: "api.failed" });
});
it("bounds and coalesces diagnostics, marks stale gauges invalid, and ignores late timed-out results", async () => {
  const metrics = createMetrics("worker");
  metrics.gauge("outbox_pending", 3);
  let resolve!: (value: { outbox_pending: number }) => void;
  const read = vi.fn(
    () =>
      new Promise<{ outbox_pending: number }>((r) => {
        resolve = r;
      }),
  );
  const collect = createMetricCollection(metrics, [{ name: "outbox", read }], 10);
  await Promise.all(Array.from({ length: 20 }, collect));
  await collect();
  expect(read).toHaveBeenCalledTimes(1);
  expect(metrics.render()).toContain('collector="outbox"} 0');
  resolve({ outbox_pending: 99 });
  await tick();
  expect(metrics.render()).toContain('hambazi_outbox_pending{service="worker"} 3');
});
it("measures bounded dependency failures and monotonic admission without error content", async () => {
  const metrics = createMetrics("api");
  const health = createServiceHealth(
    [
      {
        name: "postgres",
        required: true,
        probe: async () => {
          throw new Error("PRIVATE");
        },
      },
    ],
    10,
    metrics,
  );
  health.started();
  await health.ready();
  health.stopAdmission();
  health.started();
  expect(metrics.render()).toContain('dependency="postgres"} 0');
  expect(metrics.render()).toContain('hambazi_admitting{service="api"} 0');
  expect(metrics.render()).not.toContain("PRIVATE");
});
it("rejects malformed aggregate samples without reading getters or replacing valid gauges", async () => {
  const metrics = createMetrics("api");
  metrics.gauge("outbox_pending", 3);
  const getter = vi.fn(() => "PRIVATE");
  const values = { outbox_pending: 99 };
  Object.defineProperty(values, "outbox_failed", { get: getter });
  const collect = createMetricCollection(
    metrics,
    [{ name: "outbox", read: async () => values }],
    10,
  );
  await collect();
  expect(getter).not.toHaveBeenCalled();
  expect(metrics.render()).toContain('collector="outbox"} 0');
  expect(metrics.render()).toContain('hambazi_outbox_pending{service="api"} 3');
});
it("keeps metrics opt-in, exact-GET loopback-only, and independent of dependency outages", async () => {
  const metrics = createMetrics("bot");
  const health = createServiceHealth(
    [{ name: "backend", required: true, probe: async () => false }],
    10,
    metrics,
  );
  health.started();
  const local = await startHealthServer(health, 0, { metrics });
  const disabled = await startHealthServer(health, 0);
  try {
    const base = `http://127.0.0.1:${local.port}/v1/metrics`;
    const response = await fetch(base);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("version=0.0.4");
    expect(await response.text()).toContain('dependency="backend"} 0');
    for (const headers of [
      { origin: "PRIVATE" },
      { forwarded: "PRIVATE" },
      { "x-forwarded-host": "PRIVATE" },
    ])
      expect((await fetch(base, { headers })).status).toBe(404);
    expect((await fetch(base + "?token=PRIVATE")).status).toBe(404);
    expect((await fetch(base, { method: "POST" })).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${disabled.port}/v1/metrics`)).status).toBe(404);
  } finally {
    await local.close();
    await disabled.close();
  }
});
it("reports only constructed safe error events, drops expected errors, bounds concurrency and cooldown, flushes and stops", async () => {
  const metrics = createMetrics("api");
  let resolve!: () => void;
  const send = vi.fn(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const reporter = createSafeReporter({ service: "api", metrics, send });
  reporter.emit("socket.completed", { errorCode: "GAME_STATE_CONFLICT", state: "PRIVATE" });
  reporter.emit("PRIVATE" as never);
  reporter.emit("http.completed", {
    errorCode: "INTERNAL_ERROR",
    userId: randomUUID(),
    chat: "PRIVATE",
    request: "PRIVATE",
    stack: "PRIVATE",
    breadcrumbs: ["PRIVATE"],
    state: "PRIVATE",
  });
  reporter.emit("api.failed");
  await tick();
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(send.mock.calls[0])).not.toMatch(
    /PRIVATE|userId|request|stack|breadcrumbs|state/,
  );
  const payload = send.mock.calls[0] as unknown as [Record<string, unknown>];
  expect(Object.keys(payload[0]).sort()).toEqual([
    "event_id",
    "fingerprint",
    "level",
    "logger",
    "message",
    "platform",
    "tags",
    "timestamp",
  ]);
  resolve();
  await tick();
  reporter.emit("http.completed", { errorCode: "INTERNAL_ERROR" });
  expect(metrics.render()).toContain('result="dropped"} 2');
  await reporter.close();
  reporter.emit("worker.failed");
  expect(send).toHaveBeenCalledTimes(1);
});
it("contains reporting rejection and sanitizes invalid destination errors", async () => {
  const metrics = createMetrics("worker");
  const reporter = createSafeReporter({
    service: "worker",
    metrics,
    send: async () => {
      throw new Error("PRIVATE");
    },
  });
  reporter.emit("worker.failed");
  await reporter.close();
  expect(metrics.render()).toContain('result="failed"} 1');
  expect(metrics.render()).not.toContain("PRIVATE");
  for (const value of [
    "PRIVATE",
    "http://PRIVATE",
    "https://PRIVATE@example.com/1",
    `https://${"a".repeat(32)}@example.com/1?token=PRIVATE`,
  ])
    expect(() => sentryTarget(value)).toThrow("Invalid reporting configuration");
  expect(() => createSentryTransport({ reveal: () => "PRIVATE" })).toThrow(
    "Invalid reporting configuration",
  );
});

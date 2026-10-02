import {
  createServiceHealth,
  healthPaths,
  metricsPath,
  type OperationalMetrics,
} from "@hambazi/observability";
/** Public application surface; composition supplies probes, never module tables. */
export function createApiHealth(options: {
  postgres(signal: AbortSignal): Promise<boolean>;
  redis(signal: AbortSignal): Promise<boolean>;
  timeoutMs: number;
  metrics?: OperationalMetrics;
}) {
  return createServiceHealth(
    [
      { name: "postgres", required: true, probe: options.postgres },
      // Durable session/logout access remains admitted during Redis loss.
      { name: "redis", required: false, probe: options.redis },
    ],
    options.timeoutMs,
    options.metrics,
  );
}
const content = (statuses: readonly string[]) => ({
  "application/json": {
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "status"],
      properties: {
        schemaVersion: { type: "integer", const: 1 },
        status: { type: "string", enum: statuses },
      },
    },
  },
});
export function botHealthOperation() {
  return {
    security: [{ botService: [] }],
    description:
      "Read-only dependency readiness on the authenticated private TLS listener; does not consume product admission counters.",
    responses: {
      "200": { description: "Accepting onboarding", content: content(["READY"]) },
      "503": { description: "Dependency unavailable or draining", content: content(["NOT_READY"]) },
      "401": { description: "Service authentication required" },
      "403": { description: "Direct private TLS peer required" },
    },
  };
}
export function healthOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: { title: "HamBazi local operations health", version: "1.0.0" },
    "x-access-policy":
      "Optional loopback-only listener. Exact 127.0.0.1 Host; no browser/proxy headers. Never expose through ingress.",
    paths: {
      [metricsPath]: {
        get: {
          description:
            "Opt-in fixed-dimension process metrics on the separate loopback listener only. Never mount on product ingress.",
          responses: {
            "200": {
              description: "Prometheus text with dependency and collection validity signals",
              content: { "text/plain": { schema: { type: "string" } } },
            },
            "404": {
              description: "Disabled, invalid method, route or local access shape",
              content: content(["NOT_READY"]),
            },
            "503": { description: "Collection unavailable", content: content(["NOT_READY"]) },
          },
        },
      },
      [healthPaths.live]: {
        get: {
          responses: {
            "200": {
              description: "Process responding; downstream independent",
              content: content(["LIVE"]),
            },
            "503": { description: "Probe unavailable", content: content(["NOT_READY"]) },
            "404": {
              description: "Invalid method, route or local access shape",
              content: content(["NOT_READY"]),
            },
          },
        },
      },
      [healthPaths.ready]: {
        get: {
          responses: {
            "200": {
              description:
                "Ready, or API durable services admitted with ephemeral dependencies degraded",
              content: content(["READY", "DEGRADED"]),
            },
            "503": {
              description: "Starting, draining or required dependency unavailable",
              content: content(["NOT_READY"]),
            },
            "404": {
              description: "Invalid method, route or local access shape",
              content: content(["NOT_READY"]),
            },
          },
        },
      },
    },
  };
}

import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { createClient } from "redis";
import { io, type Socket } from "socket.io-client";
import { createRedisTransportAdmission, createRealtimeGateway } from "../../src/realtime/index.js";
import { createHttpApplication } from "../../src/composition/http.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
import { authPaths } from "../../src/auth/index.js";
import { onboardingFixture } from "../auth/onboarding-fixtures.js";
import { admissionPolicy } from "../fixtures/admission.js";
import { realtimeDependencies } from "../fixtures/realtime.js";

if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  !process.env.TEST_AUTH_REDIS_URL
)
  throw new Error("Use the isolated test:auth-http:local harness");
const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function adapters(overrides: Partial<typeof admissionPolicy> = {}) {
  const namespace = `transport-test:${randomUUID()}`;
  const policy = { ...admissionPolicy, ...overrides };
  const nodes = [];
  for (let i = 0; i < 2; i++) {
    const node = createRedisTransportAdmission({
      url: { reveal: () => process.env.TEST_AUTH_REDIS_URL! },
      namespace,
      policy,
    });
    cleanups.push(() => node.close());
    await node.connect();
    nodes.push(node);
  }
  return { nodes, namespace, policy };
}
it("atomically shares every quota across two nodes, canonicalizes subjects and never renews rejected windows", async () => {
  const { nodes, namespace } = await adapters({
    httpRequestsPerMinute: 3,
    engineRequestsPerMinute: 2,
    socketConnectionsPerMinute: 2,
    socketEventsPerMinute: 4,
  });
  const user = randomUUID();
  for (const [operation, limit] of [
    ["http", 3],
    ["engine", 2],
    ["connect", 2],
    ["event", 4],
  ] as const) {
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        operation === "http" || operation === "engine"
          ? nodes[i % 2]!.ip(i % 2 ? "::ffff:127.0.0.1" : "127.0.0.1", operation)
          : nodes[i % 2]!.rate(i % 2 ? user.toUpperCase() : user, operation),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(limit);
    expect(
      results
        .filter((result) => !result.allowed)
        .every((result) => "reason" in result && result.reason === "limited"),
    ).toBe(true);
  }
  const redis = createClient({ url: process.env.TEST_AUTH_REDIS_URL!, disableOfflineQueue: true });
  redis.on("error", () => {});
  await redis.connect();
  cleanups.push(() => redis.destroy());
  const hash = (input: string) => createHash("sha256").update(input).digest("hex");
  const key = `hambazi:transport-rate:v1:${hash(namespace)}:http:${hash("127.0.0.1")}`;
  const before = await redis.pTTL(key);
  expect(await nodes[0]!.ip("127.0.0.1", "http")).toMatchObject({
    allowed: false,
    reason: "limited",
  });
  expect(await redis.get(key)).toBe("3");
  expect(await redis.pTTL(key)).toBeLessThanOrEqual(before);
  expect(key).not.toContain("127.0.0.1");
  for (const invalid of ["not-a-counter", "0", "1.5"]) {
    await redis.set(key, invalid, { PX: 60000 });
    expect(await nodes[1]!.ip("127.0.0.1", "http")).toEqual({
      allowed: false,
      reason: "unavailable",
    });
  }
  await redis.set(key, "1");
  expect(await nodes[0]!.ip("127.0.0.1", "http")).toEqual({
    allowed: false,
    reason: "unavailable",
  });
  await redis.pExpire(key, 1);
  await vi.waitFor(async () =>
    expect(await nodes[1]!.ip("127.0.0.1", "http")).toEqual({ allowed: true }),
  );
  nodes[0]!.close();
  expect(await nodes[0]!.rate(user, "event")).toEqual({ allowed: false, reason: "unavailable" });
  expect(await nodes[1]!.probe(AbortSignal.timeout(1000))).toBe(true);
});

it("keeps near-expiry admission available across concurrent Redis nodes without renewing live windows", async () => {
  const { nodes, namespace } = await adapters({ socketEventsPerMinute: 2 });
  const redis = createClient({ url: process.env.TEST_AUTH_REDIS_URL!, disableOfflineQueue: true });
  redis.on("error", () => {});
  await redis.connect();
  cleanups.push(() => redis.destroy());
  const hash = (input: string) => createHash("sha256").update(input).digest("hex");
  const subjects = Array.from({ length: 64 }, () => randomUUID());
  let unavailable = 0;
  for (let wave = 0; wave < 32; wave++) {
    await Promise.all(
      subjects.map((subject) =>
        redis.set(`hambazi:transport-rate:v1:${hash(namespace)}:event:${hash(subject)}`, "2", {
          PX: 1,
        }),
      ),
    );
    const decisions = await Promise.all(
      subjects.flatMap((subject) => nodes.map((node) => node.rate(subject, "event"))),
    );
    unavailable += decisions.filter(
      (decision) => !decision.allowed && decision.reason === "unavailable",
    ).length;
  }
  expect(unavailable).toBe(0);
});

it("shares HTTP pre-authentication admission across applications before parsing or authenticating", async () => {
  const { nodes, policy } = await adapters({ httpRequestsPerMinute: 3 });
  const instances: Awaited<ReturnType<typeof createHttpApplication>>[] = [];
  const authenticate = [];
  for (const node of nodes) {
    const f = onboardingFixture();
    const sessions = { ...f.service };
    authenticate.push(vi.spyOn(sessions, "authenticate"));
    const app = await createHttpApplication({
      auth: {
        sessions,
        telegram: f.telegram,
        clock: f.clock,
        onboarding: f.onboarding,
        limiter: {
          consumeIp: async () => ({ allowed: true }),
          consumeIdentity: async () => ({ allowed: true }),
        },
      },
      admission: { policy, ip: node.ip },
      allowedOrigins: ["https://mini.example"],
      trustedProxies: [],
      production: false,
      logger: createSafeLogger({ write: () => {} }),
    });
    cleanups.push(() => app.app.close());
    instances.push(app);
  }
  const forged =
    [{ alg: "HS256", kid: "forged" }, { sub: "forged" }]
      .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
      .join(".") +
    "." +
    Buffer.from("invalid-signature").toString("base64url");
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      instances[i % 2]!.server.inject({
        url: authPaths.inspect,
        headers: { authorization: `Bearer ${forged}` },
      }),
    ),
  );
  expect(results.filter((r) => r.statusCode === 401)).toHaveLength(3);
  expect(results.filter((r) => r.statusCode === 429)).toHaveLength(7);
  expect(authenticate.reduce((count, mock) => count + mock.mock.calls.length, 0)).toBe(3); // only admitted attempts reach JWT/session work
  const malformed = await instances[1]!.server.inject({
    method: "POST",
    url: authPaths.issue,
    headers: { "content-type": "application/json" },
    payload: "private-malformed-json",
  });
  expect(malformed.statusCode).toBe(429);
  expect(malformed.body).not.toContain("private-malformed-json");
});

it("shares Engine.IO and authenticated user admission across two actual Socket servers", async () => {
  const { nodes, policy } = await adapters({
    socketConnectionsPerMinute: 2,
    socketEventsPerMinute: 2,
  });
  const urls: string[] = [];
  const fixtures = [];
  for (const node of nodes) {
    const f = realtimeDependencies();
    fixtures.push(f);
    f.ports.admission = { policy, ip: node.ip, trustedProxies: [], production: false };
    f.ports.rate = node.rate;
    const server = createServer();
    const gateway = createRealtimeGateway(server, f.ports);
    cleanups.push(async () => {
      await gateway.close();
      if (server.listening) await new Promise<void>((r) => server.close(() => r()));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing isolated address");
    urls.push(`http://127.0.0.1:${address.port}`);
  }
  async function connect(node: number) {
    const socket = io(`${urls[node]}/v1`, {
      path: "/v1/socket.io",
      transports: ["websocket"],
      reconnection: false,
      auth: { schemaVersion: 1, accessToken: "valid" },
      timeout: 1000,
    });
    cleanups.push(() => {
      socket.disconnect();
    });
    return await new Promise<{ socket: Socket; error?: Error & { data?: { code: string } } }>(
      (resolve) => {
        socket.once("connect", () => resolve({ socket }));
        socket.once("connect_error", (error) => resolve({ socket, error }));
      },
    );
  }
  const a = await connect(0),
    b = await connect(1),
    denied = await connect(0);
  expect(a.error).toBeUndefined();
  expect(b.error).toBeUndefined();
  expect(denied.error?.data?.code).toBe("RATE_LIMITED");
  expect(
    await a.socket.timeout(1000).emitWithAck("unknown:event", { text: "private" }),
  ).toMatchObject({ error: { code: "INVALID_INPUT" } });
  expect(
    await b.socket.timeout(1000).emitWithAck("presence:ping", { schemaVersion: 1 }),
  ).toMatchObject({ ok: true });
  fixtures.forEach((f) => f.authenticate.mockClear());
  expect(
    await a.socket.timeout(1000).emitWithAck("presence:ping", { schemaVersion: 1 }),
  ).toMatchObject({ error: { code: "RATE_LIMITED" } });
  expect(fixtures[0]!.authenticate).not.toHaveBeenCalled();
  expect(
    fixtures.every((f) => f.join.mock.calls.length === 0 && f.command.mock.calls.length === 0),
  ).toBe(true);
});

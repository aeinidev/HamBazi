import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { io, type Socket } from "socket.io-client";
import { Queue } from "bullmq";
import { expect, it, vi } from "vitest";
import {
  createRealtimeGateway,
  createRealtimeRedisAdapter,
  createRealtimeConsumer,
} from "../../src/realtime/index.js";
import { realtimeDependencies } from "../fixtures/realtime.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  !process.env.TEST_AUTH_REDIS_URL
)
  throw new Error("Use isolated test:auth-http:local harness");
it("fans out committed wakeups across two Redis nodes, consumes BullMQ jobs and fails closed on adapter loss", async () => {
  const namespace = `realtime-${randomUUID()}`;
  const redisUrl = { reveal: () => process.env.TEST_AUTH_REDIS_URL! };
  const nodes: {
    gateway: ReturnType<typeof createRealtimeGateway>;
    redis: Awaited<ReturnType<typeof createRealtimeRedisAdapter>>;
    url: string;
  }[] = [];
  const clients: Socket[] = [];
  const userId = "11111111-1111-4111-8111-111111111111";
  const matchId = "44444444-4444-4444-8444-444444444444";
  let consumer: ReturnType<typeof createRealtimeConsumer> | undefined;
  let queue: Queue | undefined;
  const snapshots: unknown[] = [];
  const projected: { stateVersion: number; lastEventSeq: number }[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const redis = await createRealtimeRedisAdapter({ redisUrl, namespace, timeoutMs: 1000 });
      const deps = realtimeDependencies().ports;
      const snapshot = {
        schemaVersion: 1 as const,
        matchId,
        stateVersion: 1,
        lastEventSeq: 1,
        status: "ACTIVE" as const,
        role: "PLAYER" as const,
        gameId: "coup",
        engineVersion: "coup-v1",
        stateSchemaVersion: 4,
        rulesetVersion: "test",
        view: { viewerId: userId, node: i },
      };
      projected.push(snapshot);
      deps.delivery = {
        redis,
        ackTimeoutMs: 1000,
        resync: {
          snapshot: async () => ({ ok: true, value: snapshot }),
          catchup: async () => ({
            ok: true,
            value: { schemaVersion: 1, mode: "SNAPSHOT", events: [], snapshot },
          }),
        },
      };
      const server = createServer();
      const gateway = createRealtimeGateway(server, deps);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No listener");
      nodes.push({ gateway, redis, url: `http://127.0.0.1:${address.port}/v1` });
      await vi.waitFor(() => expect(gateway.ready()).toBe(true));
      const client = io(nodes[i]!.url, {
        path: "/v1/socket.io",
        auth: { schemaVersion: 1, accessToken: "valid" },
        transports: ["websocket"],
        reconnection: false,
      });
      clients.push(client);
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
      });
      client.on("match:snapshot", (value: { lastEventSeq: number }, ack: (seq: number) => void) => {
        snapshots.push(value);
        ack(value.lastEventSeq);
      });
      await client.emitWithAck("match:subscribe", { schemaVersion: 1, matchId });
    }
    const event = {
      schemaVersion: 1,
      eventId: randomUUID(),
      aggregateId: matchId,
      occurredAt: 1000,
      correlation: {},
      type: "MATCH_CHANGED_V1",
      payload: { schemaVersion: 1, matchId, stateVersion: 1, lastEventSeq: 1, status: "ACTIVE" },
    };
    await nodes[0]!.gateway.publish(event);
    expect(snapshots).toHaveLength(2);
    expect(snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ view: { viewerId: userId, node: 0 } }),
        expect.objectContaining({ view: { viewerId: userId, node: 1 } }),
      ]),
    );
    consumer = createRealtimeConsumer({
      redisUrl,
      namespace,
      publish: nodes[0]!.gateway.publish,
      unavailable: () => {},
    });
    await consumer.ready();
    const url = new URL(redisUrl.reveal());
    queue = new Queue("match-changed-v1", {
      prefix: `hambazi:jobs:${namespace}`,
      connection: {
        host: url.hostname,
        port: Number(url.port),
        username: url.username,
        password: url.password,
      },
    });
    await queue.add(event.type, event, { jobId: event.eventId, removeOnComplete: true });
    await vi.waitFor(async () => expect(await queue!.getJob(event.eventId)).toBeUndefined());
    expect(snapshots).toHaveLength(2); // Acknowledged checkpoints cover the queued duplicate.
    await consumer.close();
    consumer = undefined;
    await nodes[1]!.redis.close();
    expect(nodes[1]!.gateway.ready()).toBe(false);
    await expect(nodes[1]!.gateway.publish(event)).rejects.toThrow();
    await vi.waitFor(() => expect(clients[1]!.connected).toBe(false));
    // Surviving node continues; a client on an absent subscriber must resync/reconnect.
    projected.forEach((snapshot) => {
      snapshot.stateVersion = 2;
      snapshot.lastEventSeq = 2;
    });
    await nodes[0]!.gateway.publish({
      ...event,
      payload: { ...event.payload, stateVersion: 2, lastEventSeq: 2 },
    });
    expect(snapshots).toHaveLength(3);
  } finally {
    await consumer?.close();
    for (const client of clients) client.disconnect();
    for (const node of nodes) {
      await node.gateway.close();
      await node.redis.close();
    }
    if (queue) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }
}, 20000);

it("keeps unrelated tables flowing under a blocked recipient with bounded concurrent delivery", async () => {
  const namespace = `delivery-load-${randomUUID()}`;
  const redisUrl = { reveal: () => process.env.TEST_AUTH_REDIS_URL! };
  const ids = Array.from({ length: 16 }, () => randomUUID());
  const userId = "11111111-1111-4111-8111-111111111111";
  const deps = realtimeDependencies().ports;
  const clients: Socket[] = [];
  const seen = new Set<string>();
  let held: (() => void) | undefined;
  let active = 0,
    maximumActive = 0;
  const projectionCalls = new Map<string, number>();
  deps.membership = {
    authorize: async (_actor, input) => ({
      ok: true,
      value: {
        schemaVersion: 1,
        matchId: (input as { matchId: string }).matchId,
        role: "PLAYER",
      },
    }),
  };
  deps.delivery = {
    ackTimeoutMs: 5000,
    resync: {
      snapshot: vi.fn(),
      catchup: async (_actor, input) => {
        const matchId = (input as { matchId: string }).matchId;
        projectionCalls.set(matchId, (projectionCalls.get(matchId) ?? 0) + 1);
        return {
          ok: true,
          value: {
            schemaVersion: 1,
            mode: "SNAPSHOT",
            events: [],
            snapshot: {
              schemaVersion: 1,
              matchId,
              stateVersion: 1,
              lastEventSeq: 1,
              status: "ACTIVE",
              role: "PLAYER",
              gameId: "coup",
              engineVersion: "coup-v1",
              stateSchemaVersion: 4,
              rulesetVersion: "test",
              view: { viewerId: userId },
            },
          },
        };
      },
    },
  };
  const server = createServer();
  const gateway = createRealtimeGateway(server, deps);
  let consumer: ReturnType<typeof createRealtimeConsumer> | undefined;
  let queue: Queue | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing listener");
    for (const matchId of ids) {
      const client = io(`http://127.0.0.1:${address.port}/v1`, {
        path: "/v1/socket.io",
        auth: { schemaVersion: 1, accessToken: "valid" },
        transports: ["websocket"],
        reconnection: false,
      });
      clients.push(client);
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
      });
      client.on(
        "match:snapshot",
        (snapshot: { lastEventSeq: number }, respond: (seq: number) => void) => {
          if (matchId === ids[0] && held === undefined)
            held = () => {
              seen.add(matchId);
              respond(snapshot.lastEventSeq);
            };
          else {
            seen.add(matchId);
            respond(snapshot.lastEventSeq);
          }
        },
      );
      await client.emitWithAck("match:subscribe", { schemaVersion: 1, matchId });
    }
    const options = {
      redisUrl,
      namespace,
      concurrency: 4,
      unavailable() {},
      async publish(event: unknown) {
        active++;
        maximumActive = Math.max(maximumActive, active);
        try {
          await gateway.publish(event);
        } finally {
          active--;
        }
      },
    };
    consumer = createRealtimeConsumer(options);
    await consumer.ready();
    const url = new URL(redisUrl.reveal());
    queue = new Queue("match-changed-v1", {
      prefix: `hambazi:jobs:${namespace}`,
      connection: {
        host: url.hostname,
        port: Number(url.port),
        username: url.username,
        password: url.password,
      },
    });
    const offer = (matchId: string) => {
      const eventId = randomUUID();
      return queue!.add(
        "MATCH_CHANGED_V1",
        {
          schemaVersion: 1,
          eventId,
          aggregateId: matchId,
          occurredAt: 1000,
          correlation: {},
          type: "MATCH_CHANGED_V1",
          payload: {
            schemaVersion: 1,
            matchId,
            stateVersion: 1,
            lastEventSeq: 1,
            status: "ACTIVE",
          },
        },
        { jobId: eventId, removeOnComplete: true },
      );
    };
    await offer(ids[0]!);
    await vi.waitFor(() => expect(held).toBeDefined());
    await offer(ids[0]!);
    await Promise.all(ids.slice(1).flatMap((id) => [offer(id), offer(id)]));
    // Independent tables complete while the original recipient still withholds its ACK.
    await vi.waitFor(() => expect(seen.size).toBe(15), { timeout: 1500 });
    expect(projectionCalls.get(ids[0]!)).toBe(1); // Its second job stays behind the socket tail.
    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(4);
    let drained = false;
    const closing = consumer.close().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    held!();
    await vi.waitFor(() => expect(seen.has(ids[0]!)).toBe(true));
    await closing;
    expect(active).toBe(0);
    expect([...projectionCalls.values()]).toEqual(Array(16).fill(1));
    consumer = undefined;
  } finally {
    held?.();
    await consumer?.close();
    for (const client of clients) client.disconnect();
    await gateway.close();
    if (queue) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }
}, 15000);

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
    await vi.waitFor(() => expect(snapshots).toHaveLength(4));
    await consumer.close();
    consumer = undefined;
    await nodes[1]!.redis.close();
    expect(nodes[1]!.gateway.ready()).toBe(false);
    await expect(nodes[1]!.gateway.publish(event)).rejects.toThrow();
    await vi.waitFor(() => expect(clients[1]!.connected).toBe(false));
    // Surviving node continues; a client on an absent subscriber must resync/reconnect.
    await nodes[0]!.gateway.publish(event);
    expect(snapshots).toHaveLength(5);
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

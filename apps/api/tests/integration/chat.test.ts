import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { io, type Socket } from "socket.io-client";
import { Queue } from "bullmq";
import { createDatabase } from "@hambazi/database";
import {
  createChatPort,
  createChatRate,
  chatDeliverySchema,
  type ChatMessage,
} from "../../src/chat/index.js";
import { createMatchMembershipPort } from "../../src/matches/index.js";
import {
  createRealtimeGateway,
  createRealtimeRedisAdapter,
  createRealtimeConsumer,
} from "../../src/realtime/index.js";
import { realtimeDependencies } from "../fixtures/realtime.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  process.env.TEST_AUTH_DATABASE_READY !== "foundation-completed" ||
  !process.env.API_DATABASE_URL ||
  !process.env.TEST_DATABASE_URL ||
  !process.env.TEST_AUTH_REDIS_URL ||
  !process.env.WORKER_DATABASE_URL
)
  throw new Error("Use isolated test:auth-http:local harness");
const options = {
  poolMax: 10,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
};
const a = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const b = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
});
const admin = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
});
const worker = createDatabase({
  ...options,
  databaseUrl: { reveal: () => process.env.WORKER_DATABASE_URL! },
});
beforeAll(() => Promise.all([a.connect(), b.connect(), admin.connect(), worker.connect()]));
afterAll(() =>
  Promise.all([a.disconnect(), b.disconnect(), admin.disconnect(), worker.disconnect()]),
);
let serial = 21000000;
async function fixture() {
  const users = [randomUUID(), randomUUID()];
  const matchId = randomUUID();
  for (const userId of users)
    await admin.forModule("users").execute((db) =>
      db.user.create({
        data: {
          id: userId,
          telegramUserId: BigInt(++serial),
          publicHandle: `chat_fixture_${serial}`,
          displayName: "Chat fixture",
          status: "ACTIVE",
        },
      }),
    );
  await a.forModule("matches").transaction(async (db) => {
    await db.match.create({
      data: {
        id: matchId,
        gameId: "coup",
        status: "CREATED",
        matchType: "MATCHMAKING",
        engineVersion: "coup-v1",
        stateSchemaVersion: 4,
        rulesetVersion: "coup-provisional-complete-v1",
      },
    });
    for (const [seat, userId] of users.entries())
      await db.matchPlayer.create({
        data: { matchId, userId, seat, agentType: "HUMAN", connectionStatus: "CONNECTED" },
      });
  });
  const clock = { nowMs: () => 1000 };
  const make = (database: typeof a) =>
    createChatPort(database, {
      clock,
      policy: { messageLimit: 500, pageLimit: 50 },
      rate: async () => ({ allowed: true }),
      membership: createMatchMembershipPort(database),
    });
  const first = make(a),
    second = make(b);
  const input = (text = "<img src=x onerror=alert(1)> سلام 👩‍💻") => ({
    schemaVersion: 1,
    matchId,
    commandId: randomUUID(),
    text,
  });
  const read = (port = first, extra = {}) =>
    port.list(users[0], { schemaVersion: 1, matchId, ...extra });
  return { users, matchId, first, second, input, read, make };
}
function value<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error("Chat fixture failed");
  return result.value;
}
it("commits one message/sequence/wakeup across duplicate clients and reconstructs retries", async () => {
  const f = await fixture();
  const input = f.input();
  const sent = await Promise.all(
    Array.from({ length: 8 }, (_, i) => (i % 2 ? f.first : f.second).send(f.users[0], input)),
  );
  expect(sent.every((result) => result.ok)).toBe(true);
  expect(new Set(sent.map((result) => value(result).messageId)).size).toBe(1);
  expect(value(await f.read()).messages).toHaveLength(1);
  expect(value(await f.make(b).send(f.users[0], input))).toEqual(value(sent[0]!));
  expect(await f.second.send(f.users[0], { ...input, text: "changed" })).toMatchObject({
    error: { code: "CHAT_CONFLICT" },
  });
  const outbox = await admin
    .forModule("matches")
    .execute((db) =>
      db.outboxEvent.findMany({ where: { aggregateId: f.matchId, type: "CHAT_MESSAGE_V1" } }),
    );
  expect(outbox).toHaveLength(1);
  expect(JSON.stringify(outbox)).not.toContain(input.text);
  const match = await a
    .forModule("matches")
    .execute((db) => db.match.findUniqueOrThrow({ where: { id: f.matchId } }));
  expect(match.stateVersion).toBe(0);
  expect(match.stateJsonb).toBeNull();
});
it("allocates ordered messages for competing writers and paginates stably while new messages arrive", async () => {
  const f = await fixture();
  const concurrent = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      (i % 2 ? f.first : f.second).send(f.users[i % 2], f.input(`Concurrent ${i}`)),
    ),
  );
  expect(concurrent.every((result) => result.ok)).toBe(true);
  expect(concurrent.map((result) => value(result).seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  for (let i = 5; i <= 60; i++) value(await f.first.send(f.users[0], f.input(`Message ${i}`)));
  const latest = value(await f.read());
  expect(latest.messages.map((m) => m.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 11));
  expect(latest.hasMore).toBe(true);
  value(await f.second.send(f.users[1], f.input("arrived later")));
  const older = value(await f.read(f.second, { beforeSeq: 11 }));
  expect(older.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const catchup = value(await f.read(f.first, { afterSeq: 60 }));
  expect(catchup.messages.map((m) => m.seq)).toEqual([61]);
});
it("denies foreign and terminated members; Bot-replaced members read but cannot send", async () => {
  const f = await fixture();
  value(await f.first.send(f.users[0], f.input()));
  expect(await f.first.list(randomUUID(), { schemaVersion: 1, matchId: f.matchId })).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  expect(await f.first.send(randomUUID(), f.input())).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  await a.forModule("matches").execute((db) =>
    db.matchPlayer.update({
      where: { matchId_userId: { matchId: f.matchId, userId: f.users[0]! } },
      data: { agentType: "BOT", connectionStatus: "REPLACED_BY_BOT", replacedAt: new Date(1000) },
    }),
  );
  expect(await f.read()).toMatchObject({ ok: true, value: { role: "SPECTATOR", canSend: false } });
  expect(await f.first.send(f.users[0], f.input())).toMatchObject({ error: { code: "FORBIDDEN" } });
  await a
    .forModule("matches")
    .execute((db) => db.match.update({ where: { id: f.matchId }, data: { status: "TERMINATED" } }));
  expect(await f.read()).toMatchObject({ error: { code: "NOT_FOUND" } });
});
it("rolls back message/stream on outbox failure and retains safe retry identity", async () => {
  const f = await fixture();
  const scoped = a.forModule("chat");
  const failing = {
    ...a,
    forModule: () => ({
      ...scoped,
      transaction: (operation: Parameters<typeof scoped.transaction>[0]) =>
        scoped.transaction((db) =>
          operation({
            ...db,
            outboxEvent: {
              create: () => {
                throw new Error("PRIVATE_CHAT_FAILURE");
              },
            } as typeof db.outboxEvent,
          }),
        ),
    }),
  } as typeof a;
  const input = f.input();
  const result = await f.make(failing).send(f.users[0], input);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_CHAT_FAILURE|onerror/);
  expect(result).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  expect(value(await f.read()).lastSeq).toBe(0);
  expect(value(await f.first.send(f.users[0], input)).seq).toBe(1);
});
it("excludes unversioned legacy inserts and keeps Worker/content/stream privileges restricted", async () => {
  const f = await fixture();
  await a.forModule("chat").execute((db) =>
    db.chatMessage.create({
      data: {
        id: randomUUID(),
        matchId: f.matchId,
        userId: f.users[0]!,
        schemaVersion: 1,
        text: "Legacy",
        createdAt: new Date(0),
      },
    }),
  );
  expect(value(await f.read()).messages).toEqual([]);
  await expect(
    worker.forModule("chat").execute((db) => db.chatMessage.findMany()),
  ).rejects.toThrow();
  await expect(
    worker.forModule("chat").execute((db) => db.chatStream.findMany()),
  ).rejects.toThrow();
  const sent = value(await f.first.send(f.users[0], f.input()));
  await expect(
    a
      .forModule("chat")
      .execute((db) =>
        db.chatMessage.update({ where: { id: sent.messageId }, data: { text: "changed" } }),
      ),
  ).rejects.toThrow();
});
it("shares Redis budgets across nodes and fails closed on unavailable control without losing history", async () => {
  const f = await fixture();
  const namespace = randomUUID();
  const rates = [0, 1].map(() =>
    createChatRate({
      url: { reveal: () => process.env.TEST_AUTH_REDIS_URL! },
      namespace,
      sendLimit: 2,
      readLimit: 3,
    }),
  );
  await Promise.all(rates.map((rate) => rate.connect()));
  try {
    const decisions = await Promise.all(
      Array.from({ length: 8 }, (_, i) => rates[i % 2]!.consume(f.users[0]!, "send")),
    );
    expect(decisions.filter((result) => result.allowed)).toHaveLength(2);
    expect((await rates[0]!.consume(f.users[0]!, "list")).allowed).toBe(true);
    rates[0]!.close();
    const port = createChatPort(a, {
      clock: { nowMs: () => 1000 },
      policy: { messageLimit: 500, pageLimit: 50 },
      membership: createMatchMembershipPort(a),
      rate: rates[0]!.consume,
    });
    expect(await port.send(f.users[0], f.input())).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
    expect(await port.list(f.users[0], { schemaVersion: 1, matchId: f.matchId })).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
    value(await f.first.send(f.users[0], f.input("durable")));
    expect(value(await f.read()).messages).toHaveLength(1);
  } finally {
    for (const rate of rates) rate.close();
  }
});
it("fans out committed Chat through two real Redis/Socket nodes and content-free BullMQ jobs; revoked sockets get nothing", async () => {
  const f = await fixture();
  const namespace = `chat-${randomUUID()}`;
  const redisUrl = { reveal: () => process.env.TEST_AUTH_REDIS_URL! };
  const nodes: {
    gateway: ReturnType<typeof createRealtimeGateway>;
    redis: Awaited<ReturnType<typeof createRealtimeRedisAdapter>>;
  }[] = [];
  const clients: Socket[] = [];
  const received: ChatMessage[] = [];
  let consumer: ReturnType<typeof createRealtimeConsumer> | undefined;
  let queue: Queue | undefined;
  let revoked = false;
  try {
    for (let i = 0; i < 2; i++) {
      const redis = await createRealtimeRedisAdapter({ redisUrl, namespace, timeoutMs: 1000 });
      const deps = realtimeDependencies().ports;
      deps.sessions = {
        authenticate: async () =>
          revoked
            ? {
                ok: false,
                error: {
                  code: "UNAUTHENTICATED",
                  message: "Authentication required",
                  retryable: false,
                },
              }
            : {
                ok: true,
                session: {
                  schemaVersion: 1,
                  userId: f.users[0]!,
                  sessionId: f.users[1]!,
                  expiresAt: 2000000000,
                },
              },
      };
      deps.delivery = {
        redis,
        ackTimeoutMs: 500,
        resync: {
          snapshot: async () => {
            throw new Error("Unused fixture");
          },
          catchup: async () => {
            throw new Error("Unused fixture");
          },
        },
      };
      deps.chat = { port: i === 0 ? f.first : f.second, ackTimeoutMs: 500 };
      const server = createServer();
      const gateway = createRealtimeGateway(server, deps);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No listener");
      nodes.push({ gateway, redis });
      await vi.waitFor(() => expect(gateway.ready()).toBe(true));
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
      client.on("chat:message", (message: ChatMessage, ack: (id: string) => void) => {
        received.push(message);
        ack(message.messageId);
      });
      expect(
        await client.emitWithAck("chat:list", { schemaVersion: 1, matchId: f.matchId }),
      ).toMatchObject({ ok: true });
      expect(
        await client.emitWithAck("chat:send", { ...f.input(), userId: f.users[0] }),
      ).toMatchObject({ error: { code: "INVALID_INPUT" } });
    }
    const input = f.input();
    expect(await clients[0]!.emitWithAck("chat:send", input)).toMatchObject({ ok: true });
    expect(received).toHaveLength(0); // Adapter never publishes before durable outbox dispatch.
    const row = await admin.forModule("matches").execute((db) =>
      db.outboxEvent.findFirstOrThrow({
        where: { aggregateId: f.matchId, type: "CHAT_MESSAGE_V1" },
      }),
    );
    const event = chatDeliverySchema.parse({
      schemaVersion: 1,
      eventId: row.id,
      aggregateId: row.aggregateId,
      occurredAt: row.createdAt.getTime(),
      type: row.type,
      payload: row.payloadJsonb,
      correlation: { requestId: row.requestId },
    });
    expect(JSON.stringify(event)).not.toContain(input.text);
    await nodes[0]!.gateway.publishChat(event);
    expect(received).toHaveLength(2);
    expect(received.every((message) => message.text === input.text)).toBe(true);
    clients[0]!.removeAllListeners("chat:message");
    clients[0]!.on("chat:message", () => {});
    await expect(nodes[0]!.gateway.publishChat(event)).rejects.toThrow("Chat publication failed");
    clients[0]!.removeAllListeners("chat:message");
    clients[0]!.on("chat:message", (message: ChatMessage, ack: (id: string) => void) => {
      received.push(message);
      ack(message.messageId);
    });
    // An unacknowledged projection closes that socket under the existing gateway
    // policy. Reconnect/resubscribe before testing durable queue recovery.
    await vi.waitFor(() => expect(clients[0]!.connected).toBe(false));
    const reconnected = new Promise<void>((resolve, reject) => {
      clients[0]!.once("connect", resolve);
      clients[0]!.once("connect_error", reject);
    });
    clients[0]!.connect();
    await reconnected;
    expect(
      await clients[0]!.emitWithAck("chat:list", { schemaVersion: 1, matchId: f.matchId }),
    ).toMatchObject({ ok: true, value: { lastSeq: 1 } });
    consumer = createRealtimeConsumer({
      kind: "CHAT_MESSAGE_V1",
      redisUrl,
      namespace,
      publish: nodes[0]!.gateway.publishChat,
      unavailable: () => {},
    });
    await consumer.ready();
    const url = new URL(redisUrl.reveal());
    queue = new Queue("chat-message-v1", {
      prefix: `hambazi:jobs:${namespace}`,
      connection: {
        host: url.hostname,
        port: Number(url.port),
        username: url.username,
        password: url.password,
      },
    });
    const before = received.length;
    await queue.add(event.type, event, { jobId: event.eventId, removeOnComplete: true });
    await vi.waitFor(() => expect(received.length).toBe(before + 2), { timeout: 5000 });
    revoked = true;
    const count = received.length;
    await nodes[0]!.gateway.publishChat(event);
    expect(received).toHaveLength(count);
    await vi.waitFor(() => expect(clients.every((client) => !client.connected)).toBe(true));
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

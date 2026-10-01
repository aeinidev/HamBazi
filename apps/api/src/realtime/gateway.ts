import { chatDeliverySchema, type ChatPort } from "../chat/index.js";
import type { PresencePort } from "../presence/index.js";
import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import type { AuthSessions } from "../auth/index.js";
import type { RoomsPort } from "../rooms/index.js";
import {
  matchDomainEventSchema,
  type MatchResyncPort,
  type MatchMembershipPort,
  type MatchProcessingPort,
} from "../matches/index.js";
import type { createMatchmaking } from "../matchmaking/index.js";
import {
  handshakeSchema,
  incomingEvents,
  matchSubscriptionSchema,
  roomSubscriptionSchema,
  type IncomingEvent,
} from "./contracts.js";

import type { createRealtimeRedisAdapter } from "./redis-adapter.js";

type MatchmakingPort = ReturnType<typeof createMatchmaking>;
type Ack = (result: unknown) => void;
export type RealtimeRate = (
  userId: string,
  operation: "connect" | "event",
) => Promise<
  | { allowed: true }
  | { allowed: false; reason: "limited" | "unavailable"; retryAfterSeconds?: number }
>;
export interface RealtimeDependencies {
  chat?: { port: ChatPort; ackTimeoutMs: number };
  presence?: {
    port: PresencePort;
    heartbeatIntervalMs: number;
    heartbeatTimeoutMs: number;
    leaseMs: number;
  };
  delivery?: {
    resync: MatchResyncPort;
    redis?: Awaited<ReturnType<typeof createRealtimeRedisAdapter>>;
    ackTimeoutMs: number;
  };
  sessions: Pick<AuthSessions, "authenticate">;
  rooms: Pick<RoomsPort, "read" | "join" | "leave" | "start">;
  matches: Pick<MatchProcessingPort, "command" | "ready">;
  membership: MatchMembershipPort;
  matchmaking: Pick<MatchmakingPort, "search" | "read" | "cancel" | "found" | "admit">;
  rate: RealtimeRate;
  allowedOrigins: readonly string[];
  nowMs(): number;
}

function failure(code: "UNAUTHENTICATED" | "INVALID_INPUT" | "INTERNAL_ERROR" | "RATE_LIMITED") {
  return createErrorEnvelope(code);
}
function transportError(result: ErrorEnvelope) {
  const error = new Error(result.error.message);
  Object.assign(error, { data: result.error });
  return error;
}
function safeAck(ack: Ack, value: unknown) {
  try {
    ack(value);
  } catch {
    // A dropped client cannot undo an application result; stable IDs support retry.
  }
}

/** Adapter only: every mutation and membership decision goes through a public port. */
export function createRealtimeGateway(httpServer: HttpServer, deps: RealtimeDependencies) {
  let draining = false;
  const pending = new Set<Promise<void>>();
  const tails = new WeakMap<Socket, Promise<void>>();
  const cursors = new WeakMap<Socket, Map<string, number>>();
  const available = () => !draining && (deps.delivery?.redis?.ready() ?? true);
  function enqueue(socket: Socket, operation: () => Promise<void>): Promise<void> {
    const task = (tails.get(socket) ?? Promise.resolve()).then(operation);
    const safe = task.catch(() => {
      socket.conn.close();
    });
    tails.set(socket, safe);
    pending.add(safe);
    void safe.finally(() => pending.delete(safe));
    return task;
  }
  if (
    deps.chat &&
    (!Number.isInteger(deps.chat.ackTimeoutMs) ||
      deps.chat.ackTimeoutMs < 100 ||
      deps.chat.ackTimeoutMs > 30000)
  )
    throw new Error("Invalid chat delivery configuration");
  if (
    deps.delivery &&
    (!Number.isInteger(deps.delivery.ackTimeoutMs) ||
      deps.delivery.ackTimeoutMs < 100 ||
      deps.delivery.ackTimeoutMs > 30000)
  )
    throw new Error("Invalid realtime delivery configuration");
  if (
    deps.presence &&
    (!deps.delivery ||
      ![
        deps.presence.heartbeatIntervalMs,
        deps.presence.heartbeatTimeoutMs,
        deps.presence.leaseMs,
      ].every((x) => Number.isInteger(x) && x > 0 && x <= 86400000) ||
      deps.presence.heartbeatIntervalMs + deps.presence.heartbeatTimeoutMs >= deps.presence.leaseMs)
  )
    throw new Error("Invalid presence heartbeat configuration");
  const io = new Server(httpServer, {
    ...(deps.presence
      ? {
          pingInterval: deps.presence.heartbeatIntervalMs,
          pingTimeout: deps.presence.heartbeatTimeoutMs,
        }
      : {}),
    path: "/v1/socket.io",
    serveClient: false,
    allowEIO3: false,
    maxHttpBufferSize: 16384,
    perMessageDeflate: false,
    cors: { origin: [...deps.allowedOrigins], methods: ["GET", "POST"] },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, origin === undefined || deps.allowedOrigins.includes(origin));
    },
  });
  if (deps.delivery?.redis) io.adapter(deps.delivery.redis.adapter);
  io.of("/").use((_socket, next) => next(transportError(failure("INVALID_INPUT"))));
  const namespace = io.of("/v1");
  const stopObserving = deps.delivery?.redis?.onUnavailable(() => {
    for (const socket of namespace.sockets.values()) socket.conn.close();
  });
  const identities = new WeakMap<
    Socket,
    { token: string; userId: string; sessionId: string; expiresAt: number }
  >();
  namespace.use(async (socket, next) => {
    if (!available()) return next(transportError(failure("INTERNAL_ERROR")));
    const parsed = handshakeSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) return next(transportError(failure("UNAUTHENTICATED")));
    const authenticated = await deps.sessions.authenticate(parsed.data.accessToken);
    if (!authenticated.ok) return next(transportError(authenticated));
    if (authenticated.session.expiresAt * 1000 <= deps.nowMs())
      return next(transportError(failure("UNAUTHENTICATED")));
    let decision: Awaited<ReturnType<RealtimeRate>>;
    try {
      decision = await deps.rate(authenticated.session.userId, "connect");
    } catch {
      return next(transportError(failure("INTERNAL_ERROR")));
    }
    if (!decision.allowed)
      return next(
        transportError(failure(decision.reason === "limited" ? "RATE_LIMITED" : "INTERNAL_ERROR")),
      );
    // The credential stays in a private weak map, outside socket.data/telemetry.
    identities.set(socket, {
      token: parsed.data.accessToken,
      userId: authenticated.session.userId,
      sessionId: authenticated.session.sessionId,
      expiresAt: authenticated.session.expiresAt,
    });
    next();
  });
  namespace.on("connection", (socket: Socket) => {
    if (!available()) {
      socket.conn.close();
      return;
    }
    cursors.set(socket, new Map());
    const identity = identities.get(socket);
    if (!identity) {
      socket.disconnect(true);
      return;
    }
    const { token, userId, sessionId } = identity;
    const expiryMs = identity.expiresAt * 1000;
    const remaining = Math.max(0, expiryMs - deps.nowMs());
    const timer = setTimeout(() => socket.disconnect(true), Math.min(remaining, 2147483647));
    timer.unref();
    const presence = deps.presence?.port.open({ userId, sessionExpiresAt: expiryMs });
    socket.on("disconnect", () => {
      clearTimeout(timer);
      void enqueue(socket, async () => {
        await presence?.close();
      }).catch(() => {});
    });
    // Only a received transport pong proves liveness; sending a ping never renews a lease.
    socket.conn.on("packet", (packet) => {
      if (packet.type !== "pong" || !presence || !available()) return;
      void enqueue(socket, async () => {
        if (!socket.connected || !available()) return;
        const current = await deps.sessions.authenticate(token);
        if (
          !current.ok ||
          current.session.userId !== userId ||
          current.session.sessionId !== sessionId ||
          current.session.expiresAt * 1000 <= deps.nowMs()
        ) {
          socket.disconnect(true);
          return;
        }
        await presence.heartbeat();
      }).catch(() => {});
    });

    async function dispatch(name: IncomingEvent, payload: unknown, ack: unknown) {
      if (typeof ack !== "function") return; // No unacknowledged mutation.
      const respond = ack as Ack;
      if (!available()) return safeAck(respond, failure("INTERNAL_ERROR"));
      try {
        const current = await deps.sessions.authenticate(token);
        if (
          !current.ok ||
          current.session.userId !== userId ||
          current.session.sessionId !== sessionId ||
          current.session.expiresAt * 1000 <= deps.nowMs()
        ) {
          safeAck(respond, current.ok ? failure("UNAUTHENTICATED") : current);
          socket.disconnect(true);
          return;
        }
        const decision = await deps.rate(userId, "event");
        if (!decision.allowed) {
          safeAck(
            respond,
            failure(decision.reason === "limited" ? "RATE_LIMITED" : "INTERNAL_ERROR"),
          );
          return;
        }
        const parsed = incomingEvents[name].safeParse(payload);
        if (!parsed.success) return safeAck(respond, failure("INVALID_INPUT"));
        let outcome: unknown;
        switch (name) {
          case "room:subscribe": {
            const input = roomSubscriptionSchema.parse(parsed.data);
            const read = await deps.rooms.read(userId, input.roomId);
            if (read.ok) await socket.join(`room:${input.roomId}`);
            outcome = read;
            break;
          }
          case "room:join":
            outcome = await deps.rooms.join(userId, parsed.data);
            break;
          case "room:leave": {
            const result = await deps.rooms.leave(userId, parsed.data);
            if (result.ok) await socket.leave(`room:${result.roomId}`);
            outcome = result;
            break;
          }
          case "room:start":
            outcome = await deps.rooms.start(userId, parsed.data);
            break;
          case "matchmaking:search":
            outcome = await deps.matchmaking.search(token, parsed.data);
            break;
          case "matchmaking:status":
            outcome = await deps.matchmaking.read(token, parsed.data);
            break;
          case "matchmaking:cancel":
            outcome = await deps.matchmaking.cancel(token, parsed.data);
            break;
          case "matchmaking:found": {
            const result = await deps.matchmaking.found(token, parsed.data);
            outcome = result.ok
              ? {
                  ok: true,
                  value: { ...result.value, admissionToken: result.value.admissionToken.reveal() },
                }
              : result;
            break;
          }
          case "matchmaking:admit":
            outcome = await deps.matchmaking.admit(token, parsed.data);
            break;
          case "match:subscribe": {
            const input = matchSubscriptionSchema.parse(parsed.data);
            const result = await deps.membership.authorize(userId, input);
            outcome = result;
            if (result.ok) {
              await socket.join(`match:${input.matchId}`);
              cursors.get(socket)?.set(input.matchId, 0);
              if (presence) {
                const snapshot = await presence.subscribe(input.matchId);
                const received: unknown = await socket
                  .timeout(deps.delivery!.ackTimeoutMs)
                  .emitWithAck("match:snapshot", snapshot);
                if (received !== snapshot.lastEventSeq)
                  throw new Error("Realtime acknowledgement invalid");
                cursors.get(socket)?.set(input.matchId, snapshot.lastEventSeq);
                outcome = { ok: true, value: { ...result.value, role: snapshot.role } };
              }
            }
            break;
          }
          case "match:snapshot":
            outcome = deps.delivery
              ? await deps.delivery.resync.snapshot(userId, parsed.data)
              : failure("INTERNAL_ERROR");
            break;
          case "match:catchup":
            outcome = deps.delivery
              ? await deps.delivery.resync.catchup(userId, parsed.data)
              : failure("INTERNAL_ERROR");
            break;
          case "match:ready":
            outcome = await deps.matches.ready(userId, parsed.data, { requestId: randomUUID() });
            break;
          case "game:command":
            outcome = await deps.matches.command(userId, parsed.data, { requestId: randomUUID() });
            break;
          case "chat:send":
            outcome = deps.chat
              ? await deps.chat.port.send(userId, parsed.data, { requestId: randomUUID() })
              : failure("INTERNAL_ERROR");
            break;
          case "chat:list": {
            const result = deps.chat
              ? await deps.chat.port.list(userId, parsed.data)
              : failure("INTERNAL_ERROR");
            if (result.ok) await socket.join(`chat:${result.value.matchId}`);
            outcome = result;
            break;
          }
          case "presence:ping":
            await presence?.heartbeat();
            outcome = { ok: true, value: { schemaVersion: 1 } };
            break;
        }
        safeAck(respond, outcome);
      } catch {
        if (presence) socket.conn.close();
        safeAck(respond, failure("INTERNAL_ERROR"));
      }
    }
    for (const name of Object.keys(incomingEvents) as IncomingEvent[])
      socket.on(name, (payload: unknown, ack: unknown) => {
        void enqueue(socket, () => dispatch(name, payload, ack)).catch(() => {});
      });
    socket.onAny((name, ...args: unknown[]) => {
      if (Object.hasOwn(incomingEvents, name)) return;
      const ack = args.at(-1);
      if (typeof ack === "function") safeAck(ack as Ack, failure("INVALID_INPUT"));
    });
  });
  async function fanout(input: unknown) {
    const event = matchDomainEventSchema.safeParse(input);
    if (!event.success || event.data.type !== "MATCH_CHANGED_V1" || !available() || !deps.delivery)
      throw new Error("Realtime delivery unavailable");
    const matchId = event.data.aggregateId;
    const results = await Promise.allSettled(
      [...namespace.sockets.values()]
        .filter((s) => s.rooms.has(`match:${matchId}`))
        .map((socket) =>
          enqueue(socket, async () => {
            if (!socket.connected) return;
            const identity = identities.get(socket);
            if (!identity) {
              socket.disconnect(true);
              return;
            }
            const session = await deps.sessions.authenticate(identity.token);
            if (
              !session.ok ||
              session.session.userId !== identity.userId ||
              session.session.sessionId !== identity.sessionId ||
              session.session.expiresAt * 1000 <= deps.nowMs()
            ) {
              socket.disconnect(true);
              return;
            }
            const result = await deps.delivery!.resync.catchup(identity.userId, {
              schemaVersion: 1,
              matchId,
              afterSeq: cursors.get(socket)?.get(matchId) ?? 0,
            });
            if (!result.ok) {
              if (result.error.code === "NOT_FOUND" || result.error.code === "FORBIDDEN") {
                await socket.leave(`match:${matchId}`);
                return;
              }
              throw new Error("Realtime projection unavailable");
            }
            if (!available()) throw new Error("Realtime delivery unavailable");
            // Session may expire while waiting for the database/earlier socket work.
            const current = await deps.sessions.authenticate(identity.token);
            if (
              !current.ok ||
              current.session.userId !== identity.userId ||
              current.session.sessionId !== identity.sessionId ||
              current.session.expiresAt * 1000 <= deps.nowMs()
            ) {
              socket.disconnect(true);
              return;
            }
            for (const item of result.value.events) socket.emit("match:event", item);
            // Cursor advances only after recipient acknowledgement. Loss/disconnect retries from durable state.
            const ack: unknown = await socket
              .timeout(deps.delivery!.ackTimeoutMs)
              .emitWithAck("match:snapshot", result.value.snapshot);
            if (ack !== result.value.snapshot.lastEventSeq)
              throw new Error("Realtime acknowledgement invalid");
            cursors.get(socket)?.set(matchId, result.value.snapshot.lastEventSeq);
          }),
        ),
    );
    if (results.some((r) => r.status === "rejected"))
      throw new Error("Realtime delivery incomplete");
  }
  async function chatFanout(input: unknown) {
    const event = chatDeliverySchema.safeParse(input);
    if (!event.success || !available() || !deps.chat) throw new Error("Chat delivery unavailable");
    const matchId = event.data.aggregateId;
    const results = await Promise.allSettled(
      [...namespace.sockets.values()]
        .filter((socket) => socket.rooms.has(`chat:${matchId}`))
        .map((socket) =>
          enqueue(socket, async () => {
            if (!socket.connected) return;
            const identity = identities.get(socket);
            if (!identity) {
              socket.disconnect(true);
              return;
            }
            const session = await deps.sessions.authenticate(identity.token);
            if (
              !session.ok ||
              session.session.userId !== identity.userId ||
              session.session.sessionId !== identity.sessionId ||
              session.session.expiresAt * 1000 <= deps.nowMs()
            ) {
              socket.disconnect(true);
              return;
            }
            const result = await deps.chat!.port.delivery(identity.userId, event.data);
            if (!result.ok) {
              if (["NOT_FOUND", "FORBIDDEN"].includes(result.error.code)) {
                await socket.leave(`chat:${matchId}`);
                return;
              }
              throw new Error("Chat projection unavailable");
            }
            if (!available()) throw new Error("Chat delivery unavailable");
            // Local socket only: user content must not enter the Redis broadcast adapter.
            const ack: unknown = await socket
              .timeout(deps.chat!.ackTimeoutMs)
              .emitWithAck("chat:message", result.value);
            if (ack !== result.value.messageId) throw new Error("Chat acknowledgement invalid");
          }),
        ),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Chat fanout failed");
  }
  namespace.on("chat:wakeup:v1", (input: unknown, ack: unknown) => {
    if (typeof ack !== "function") return;
    void chatFanout(input).then(
      () => (ack as Ack)({ ok: true }),
      () => (ack as Ack)({ ok: false }),
    );
  });
  namespace.on("match:wakeup:v1", (input: unknown, ack: unknown) => {
    if (typeof ack !== "function") return;
    void fanout(input).then(
      () => (ack as Ack)({ ok: true }),
      () => (ack as Ack)({ ok: false }),
    );
  });
  let closing: Promise<void> | undefined;
  return Object.freeze({
    ready: available,
    async publishChat(input: unknown) {
      const event = chatDeliverySchema.safeParse(input);
      if (!event.success || !available() || !deps.chat) throw new Error("Invalid chat wakeup");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const results = await Promise.race([
          Promise.all([
            chatFanout(event.data),
            ...(deps.delivery?.redis
              ? [namespace.serverSideEmitWithAck("chat:wakeup:v1", event.data)]
              : []),
          ]),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Chat deadline")), 30000);
          }),
        ]);
        const remote = results[1];
        if (
          !available() ||
          (Array.isArray(remote) &&
            remote.some(
              (result: unknown) =>
                typeof result !== "object" ||
                result === null ||
                !("ok" in result) ||
                result.ok !== true,
            ))
        )
          throw new Error();
      } catch {
        throw new Error("Chat publication failed");
      } finally {
        clearTimeout(timer);
      }
    },
    async publish(input: unknown) {
      const event = matchDomainEventSchema.safeParse(input);
      if (!event.success || event.data.type !== "MATCH_CHANGED_V1" || !available())
        throw new Error("Invalid realtime wakeup");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const results = await Promise.race([
          Promise.all([
            fanout(event.data),
            ...(deps.delivery?.redis
              ? [namespace.serverSideEmitWithAck("match:wakeup:v1", event.data)]
              : []),
          ]),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Realtime deadline")), 30000);
          }),
        ]);
        if (!available()) throw new Error();
        const remote = results[1];
        if (
          Array.isArray(remote) &&
          remote.some(
            (r: unknown) => typeof r !== "object" || r === null || !("ok" in r) || r.ok !== true,
          )
        )
          throw new Error();
      } catch {
        throw new Error("Realtime publication failed");
      } finally {
        clearTimeout(timer);
      }
    },
    close: () =>
      (closing ??= (async () => {
        draining = true;
        stopObserving?.();
        await Promise.allSettled([...pending]);
        for (const socket of namespace.sockets.values()) socket.conn.close();
        await new Promise<void>((resolve) => io.close(() => resolve()));
        await Promise.allSettled([...pending]);
      })()),
  });
}

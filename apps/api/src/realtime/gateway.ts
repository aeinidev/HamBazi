import { chatDeliverySchema, type ChatPort } from "../chat/index.js";
import type { PresencePort } from "../presence/index.js";
import {
  createCorrelation,
  currentCorrelation,
  withCorrelation,
  withDeadline,
  type Telemetry,
  type OperationalMetrics,
} from "@hambazi/observability";
import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";
import { Server, type Socket } from "socket.io";
import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import type { AuthSessions } from "../auth/index.js";
import type { RoomsPort } from "../rooms/index.js";
import {
  matchDomainEventSchema,
  type MatchResyncPort,
  type MatchMembershipPort,
  type MatchProcessingPort,
  type PrivateRoomMatchPort,
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
import { transportAdmissionPolicySchema, type TransportAdmissionPolicy } from "@hambazi/config";
import { createPeerResolver, type IpAdmission } from "./transport-admission.js";

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
  transport?: { namespace: "/kahroba-v1"; path: "/v1/kahroba/socket.io"; coexists: boolean };
  privateRooms?: Pick<PrivateRoomMatchPort, "start" | "ready" | "command">;
  admission: {
    policy: TransportAdmissionPolicy;
    ip: IpAdmission;
    trustedProxies: readonly string[];
    production: boolean;
  };
  drainTimeoutMs?: number;
  execution?: { intentConcurrency?: number; disconnectConcurrency?: number };
  telemetry?: Telemetry;
  metrics?: OperationalMetrics;
  chat?: { port: ChatPort; ackTimeoutMs: number };
  presence?: {
    port: PresencePort;
    heartbeatIntervalMs: number;
    heartbeatTimeoutMs: number;
    leaseMs: number;
    heartbeatConcurrency?: number;
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

function failure(
  code: "UNAUTHENTICATED" | "INVALID_INPUT" | "INTERNAL_ERROR" | "RATE_LIMITED" | "FORBIDDEN",
) {
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

function intentOperation(name: string) {
  return !Object.hasOwn(incomingEvents, name)
    ? "invalid"
    : name.startsWith("room:")
      ? "room"
      : name.startsWith("matchmaking:")
        ? "matchmaking"
        : name.startsWith("chat:")
          ? "chat"
          : name === "game:command"
            ? "command"
            : name === "presence:ping"
              ? "presence"
              : name.slice(6);
}

function workSlots(concurrency: number) {
  let active = 0;
  let nextPosition = 0;
  const reserve = () => nextPosition++;
  const waiting: { position: number; resume(): void }[] = [];
  const run = async function <T>(operation: () => Promise<T>, position = reserve()): Promise<T> {
    if (active >= concurrency)
      await new Promise<void>((resume) => {
        const entry = { position, resume };
        const last = waiting.at(-1);
        if (!last || last.position <= position) waiting.push(entry);
        else
          waiting.splice(
            waiting.findIndex((queued) => queued.position > position),
            0,
            entry,
          );
      });
    else active++;
    try {
      return await operation();
    } finally {
      const next = waiting.shift();
      if (next)
        next.resume(); // Transfer the slot in original admission order among eligible waiters.
      else active--;
    }
  };
  return Object.assign(run, { reserve, snapshot: () => ({ active, waiting: waiting.length }) });
}

/** Adapter only: every mutation and membership decision goes through a public port. */
export function createRealtimeGateway(httpServer: HttpServer, deps: RealtimeDependencies) {
  if (
    deps.transport &&
    (deps.transport.namespace !== "/kahroba-v1" ||
      deps.transport.path !== "/v1/kahroba/socket.io" ||
      typeof deps.transport.coexists !== "boolean")
  )
    throw new Error("Invalid realtime transport");
  if (typeof deps.admission.production !== "boolean")
    throw new Error("Invalid transport production configuration");
  const policy = transportAdmissionPolicySchema.parse(deps.admission.policy);
  const peer = createPeerResolver(deps.admission.trustedProxies);
  const drainTimeoutMs = deps.drainTimeoutMs ?? 15000;
  if (!Number.isInteger(drainTimeoutMs) || drainTimeoutMs < 1 || drainTimeoutMs > 120000)
    throw new Error("Invalid realtime drain timeout");
  const heartbeatConcurrency = deps.presence?.heartbeatConcurrency ?? policy.maxConnections;
  if (
    !Number.isInteger(heartbeatConcurrency) ||
    heartbeatConcurrency < 1 ||
    heartbeatConcurrency > policy.maxConnections
  )
    throw new Error("Invalid presence heartbeat concurrency");
  const intentConcurrency = deps.execution?.intentConcurrency ?? policy.maxPendingTotal;
  const disconnectConcurrency = deps.execution?.disconnectConcurrency ?? policy.maxConnections;
  for (const [value, bound] of [
    [intentConcurrency, policy.maxPendingTotal],
    [disconnectConcurrency, policy.maxConnections],
  ] as const)
    if (!Number.isInteger(value) || value < 1 || value > bound)
      throw new Error("Invalid realtime execution concurrency");
  const withHeartbeatSlot = workSlots(heartbeatConcurrency);
  const withIntentSlot = workSlots(intentConcurrency);
  const withDisconnectSlot = workSlots(disconnectConcurrency);
  const activeDispatch = new Set<{ operation: string; phase: string; began: number }>();
  const completedPhases = new Map<string, { count: number; totalMs: number; maximumMs: number }>();
  function beginWork(operation: string, initialPhase: string) {
    const work = { operation, phase: initialPhase, began: performance.now() };
    activeDispatch.add(work);
    function record() {
      const key = `${work.operation}/${work.phase}`;
      const elapsed = performance.now() - work.began;
      const entry = completedPhases.get(key) ?? { count: 0, totalMs: 0, maximumMs: 0 };
      entry.count++;
      entry.totalMs += elapsed;
      entry.maximumMs = Math.max(entry.maximumMs, elapsed);
      completedPhases.set(key, entry);
    }
    return {
      phase(name: string) {
        record();
        work.phase = name;
        work.began = performance.now();
      },
      end() {
        record();
        activeDispatch.delete(work);
      },
    };
  }
  let draining = false;
  const connectedUsers = new Map<string, number>();
  let socketCount = 0;
  let retiring = 0;
  const countSockets = () => {
    deps.metrics?.gauge("sockets", socketCount);
    deps.metrics?.gauge("connected_users", connectedUsers.size);
  };
  countSockets();
  const pending = new Set<Promise<void>>();
  const handshakes = new Set<Promise<void>>();
  const engineChecks = new Set<Promise<void>>();
  let authInFlight = 0;
  let namespaceReservations = 0;
  const pendingTransports = new WeakSet<object>();
  const namespaceLeases = new WeakMap<Socket, () => void>();
  const tails = new WeakMap<Socket, Promise<void>>();
  const intentTails = new WeakMap<Socket, Promise<void>>();
  const cursors = new WeakMap<
    Socket,
    Map<string, { seq: number; stateVersion: number; role?: "PLAYER" | "SPECTATOR" }>
  >();
  const queued = new WeakMap<Socket, number>();
  const available = () => !draining && (deps.delivery?.redis?.ready() ?? true);
  function enqueue(
    socket: Socket,
    operation: () => Promise<void>,
    cleanup = false,
    schedule?: ReturnType<typeof workSlots>,
    ordered = false,
    observePhase?: (phase: string) => void,
  ): Promise<void> {
    const count = queued.get(socket) ?? 0;
    // A single disconnect cleanup per admitted connection is reserved outside normal work slots.
    if (!cleanup && (count >= policy.maxPendingPerSocket || pending.size >= policy.maxPendingTotal))
      return Promise.reject(new Error("Realtime work capacity exceeded"));
    queued.set(socket, count + 1);
    // A busy tail may temporarily make this work ineligible. Retain its
    // original slot position instead of moving it behind every newer socket.
    const position = schedule?.reserve();
    // Capture when queued, not when the preceding socket operation finishes.
    const context = currentCorrelation() ?? createCorrelation();
    const append = () => {
      const task = (tails.get(socket) ?? Promise.resolve()).then(() =>
        withCorrelation(context, operation),
      );
      // The tracked task below owns failure closure. A rejected tail must not poison later cleanup.
      const tail = task.catch(() => {});
      tails.set(socket, tail);
      void tail.then(() => {
        if (tails.get(socket) === tail) tails.delete(socket);
      });
      return task;
    };
    async function scheduled() {
      for (;;) {
        // Neither side may hold the other queue's scarce capacity while waiting:
        // a busy socket must not reserve a heartbeat execution slot, and a
        // heartbeat waiting for that slot must not occupy the socket tail.
        observePhase?.("tail");
        await tails.get(socket);
        let appended = false;
        observePhase?.("slot");
        await schedule!(async () => {
          // Release the slot only for currently unfinished socket work. A
          // completed intervening read must not send this task to the back of
          // the global FIFO again. Check/append is atomic.
          if (tails.has(socket)) return;
          appended = true;
          await append();
        }, position);
        if (appended) return;
      }
    }
    // Reserve/track deferred maintenance immediately within the same budgets.
    const run = () => (schedule ? scheduled() : append());
    // Mutations keep their arrival order separately from the transport tail.
    // Waiting for global execution capacity must not hold up recipient delivery.
    // Disconnect cleanup joins this same chain after every admitted intent.
    const task = ordered ? (intentTails.get(socket) ?? Promise.resolve()).then(run) : run();
    if (ordered)
      intentTails.set(
        socket,
        task.catch(() => {}),
      );
    const safe = task.catch(() => {
      socket.conn.close();
    });
    pending.add(safe);
    void safe.finally(() => {
      pending.delete(safe);
      queued.set(socket, (queued.get(socket) ?? 1) - 1);
    });
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
    path: deps.transport?.path ?? "/v1/socket.io",
    ...(deps.transport?.coexists ? { destroyUpgrade: false } : {}),
    serveClient: false,
    allowEIO3: false,
    maxHttpBufferSize: 16384,
    perMessageDeflate: false,
    cors: { origin: [...deps.allowedOrigins], methods: ["GET", "POST"], preflightContinue: true },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, origin === undefined || deps.allowedOrigins.includes(origin));
    },
  });
  let engineInFlight = 0;
  let initialReservations = 0;
  const reservations = new WeakMap<IncomingMessage, () => void>();
  io.engine.on("connection", (connection: { request: IncomingMessage }) =>
    reservations.get(connection.request)?.(),
  );
  io.engine.use(
    (
      request: IncomingMessage & { _query: Record<string, string> },
      response: ServerResponse,
      next: () => void,
    ) => {
      // Engine.IO treats an empty sid as a new handshake too; it must not bypass capacity.
      const initial = !request._query.sid && request.method !== "OPTIONS";
      const reject = (code: "RATE_LIMITED" | "INTERNAL_ERROR" | "FORBIDDEN", retry = 1) => {
        response.statusCode = code === "RATE_LIMITED" ? 429 : code === "FORBIDDEN" ? 403 : 503;
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        if (code === "RATE_LIMITED") response.setHeader("Retry-After", String(retry));
        // Engine.IO's upgrade response destroys denied WebSockets; polling receives the envelope.
        response.end(JSON.stringify(failure(code)));
      };
      const origin = request.headers.origin;
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Cache-Control", "no-store");
      if (deps.admission.production)
        response.setHeader("Strict-Transport-Security", "max-age=31536000");
      if (origin !== undefined && !deps.allowedOrigins.includes(origin)) return reject("FORBIDDEN");
      if (deps.admission.production && !peer.secure(request)) return reject("FORBIDDEN");
      if (!available()) return reject("INTERNAL_ERROR");
      if (
        engineInFlight >= policy.maxEngineInFlight ||
        (initial &&
          io.engine.clientsCount + initialReservations + retiring >= policy.maxConnections)
      )
        return reject("RATE_LIMITED");
      engineInFlight++;
      if (initial) initialReservations++;
      let released = false;
      const releaseInitial = () => {
        if (!initial || released) return;
        released = true;
        initialReservations--;
        reservations.delete(request);
        request.socket.off("close", releaseInitial);
        response.off?.("finish", releaseInitial);
      };
      if (initial) {
        reservations.set(request, releaseInitial);
        request.socket.once("close", releaseInitial);
        response.once?.("finish", releaseInitial);
      }
      const ip = peer(request);
      const check = (async () => {
        try {
          const decision = ip
            ? await deps.admission.ip(ip, "engine")
            : { allowed: false as const, reason: "unavailable" as const };
          if (!decision.allowed) {
            releaseInitial();
            return reject(
              decision.reason === "limited" ? "RATE_LIMITED" : "INTERNAL_ERROR",
              decision.reason === "limited" ? decision.retryAfterSeconds : 1,
            );
          }
          if (!available()) {
            releaseInitial();
            return reject("INTERNAL_ERROR");
          }
          if (request.method === "OPTIONS") {
            response.statusCode = 204;
            response.end();
            return;
          }
          next();
        } catch {
          releaseInitial();
          reject("INTERNAL_ERROR");
        } finally {
          engineInFlight--;
        }
      })();
      engineChecks.add(check);
      void check.finally(() => engineChecks.delete(check));
    },
  );
  if (deps.delivery?.redis) io.adapter(deps.delivery.redis.adapter);
  io.of("/").use((_socket, next) => next(transportError(failure("INVALID_INPUT"))));
  const namespace = io.of(deps.transport?.namespace ?? "/v1");
  const stopObserving = deps.delivery?.redis?.onUnavailable(() => {
    for (const socket of namespace.sockets.values()) socket.conn.close();
  });
  const identities = new WeakMap<
    Socket,
    { token: string; userId: string; sessionId: string; expiresAt: number }
  >();
  namespace.use((socket, next) => {
    if (
      authInFlight >= policy.maxEngineInFlight ||
      pendingTransports.has(socket.conn) ||
      socketCount + retiring + namespaceReservations >= policy.maxConnections
    )
      return next(transportError(failure("RATE_LIMITED")));
    namespaceReservations++;
    pendingTransports.add(socket.conn);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      namespaceReservations--;
      pendingTransports.delete(socket.conn);
      namespaceLeases.delete(socket);
      socket.conn.off("close", release);
    };
    namespaceLeases.set(socket, release);
    socket.conn.once("close", release);
    authInFlight++;
    let admitted = false;
    const work = (async () => {
      try {
        if (!available()) return next(transportError(failure("INTERNAL_ERROR")));
        const ip = peer(socket.request);
        const preAuth = ip
          ? await deps.admission.ip(ip, "engine")
          : { allowed: false as const, reason: "unavailable" as const };
        if (!preAuth.allowed)
          return next(
            transportError(
              failure(preAuth.reason === "limited" ? "RATE_LIMITED" : "INTERNAL_ERROR"),
            ),
          );
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
            transportError(
              failure(decision.reason === "limited" ? "RATE_LIMITED" : "INTERNAL_ERROR"),
            ),
          );
        // The credential stays in a private weak map, outside socket.data/telemetry.
        identities.set(socket, {
          token: parsed.data.accessToken,
          userId: authenticated.session.userId,
          sessionId: authenticated.session.sessionId,
          expiresAt: authenticated.session.expiresAt,
        });
        if (!available() || socket.conn.readyState !== "open")
          return next(transportError(failure("INTERNAL_ERROR")));
        admitted = true;
        next();
      } catch {
        next(transportError(failure("INTERNAL_ERROR")));
      } finally {
        authInFlight--;
        if (!admitted) release();
      }
    })();
    handshakes.add(work);
    void work.finally(() => handshakes.delete(work));
  });
  namespace.on("connection", (socket: Socket) => {
    namespaceLeases.get(socket)?.();
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
    async function stillAuthenticated() {
      const current = await deps.sessions.authenticate(token);
      return (
        current.ok &&
        current.session.userId === userId &&
        current.session.sessionId === sessionId &&
        current.session.expiresAt * 1000 > deps.nowMs()
      );
    }
    socketCount++;
    connectedUsers.set(userId, (connectedUsers.get(userId) ?? 0) + 1);
    countSockets();
    const expiryMs = identity.expiresAt * 1000;
    const remaining = Math.max(0, expiryMs - deps.nowMs());
    const timer = setTimeout(() => socket.disconnect(true), Math.min(remaining, 2147483647));
    timer.unref();
    const presence = deps.presence?.port.open({ userId, sessionExpiresAt: expiryMs });
    socket.on("disconnect", () => {
      socketCount--;
      const count = (connectedUsers.get(userId) ?? 1) - 1;
      if (count > 0) connectedUsers.set(userId, count);
      else connectedUsers.delete(userId);
      countSockets();
      clearTimeout(timer);
      retiring++;
      void enqueue(
        socket,
        async () => {
          await withDisconnectSlot(async () => {
            await presence?.close();
          });
        },
        true,
        undefined,
        true,
      )
        .catch(() => {})
        .finally(() => {
          retiring--;
        });
    });
    // Only a received transport pong proves liveness; sending a ping never renews a lease.
    let heartbeatPending = false;
    socket.conn.on("packet", (packet) => {
      if (packet.type !== "pong" || !presence || !available()) return;
      if (heartbeatPending) return;
      heartbeatPending = true;
      const work = beginWork("heartbeat", "queue");
      void enqueue(
        socket,
        async () => {
          if (!socket.connected || !available()) return;
          work.phase("authenticate");
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
          work.phase("renew");
          await presence.heartbeat();
        },
        false,
        withHeartbeatSlot,
      )
        .catch(() => {
          socket.conn.close();
        })
        .finally(() => {
          work.end();
          heartbeatPending = false;
        });
    });

    async function dispatch(
      name: string,
      payload: unknown,
      ack: unknown,
      work: ReturnType<typeof beginWork>,
    ) {
      const respond: Ack = typeof ack === "function" ? (ack as Ack) : () => {};
      const started = performance.now();
      const operation = intentOperation(name);
      const fields: Record<string, unknown> = { userId, operation };
      work.phase("rate");
      const phase = work.phase;
      const complete = (value: unknown) => {
        phase("ack");
        if (
          typeof value === "object" &&
          value !== null &&
          "ok" in value &&
          value.ok === false &&
          "error" in value
        ) {
          const error = value.error;
          if (typeof error === "object" && error !== null && "code" in error)
            fields.errorCode = error.code;
        }
        safeAck(respond, value);
      };
      try {
        // Enqueued intents were admitted before draining; preserve their owning-port outcome.
        if (!(deps.delivery?.redis?.ready() ?? true)) return complete(failure("INTERNAL_ERROR"));
        // Count malformed, unknown and unacknowledged traffic before any durable lookup.
        const decision = await deps.rate(userId, "event");
        if (!decision.allowed) {
          complete(failure(decision.reason === "limited" ? "RATE_LIMITED" : "INTERNAL_ERROR"));
          return;
        }
        if (!Object.hasOwn(incomingEvents, name)) return complete(failure("INVALID_INPUT"));
        if (typeof ack !== "function") return; // No unacknowledged mutation.
        phase("authenticate");
        const current = await deps.sessions.authenticate(token);
        if (
          !current.ok ||
          current.session.userId !== userId ||
          current.session.sessionId !== sessionId ||
          current.session.expiresAt * 1000 <= deps.nowMs()
        ) {
          complete(current.ok ? failure("UNAUTHENTICATED") : current);
          socket.disconnect(true);
          return;
        }
        const parsed = incomingEvents[name as IncomingEvent].safeParse(payload);
        if (!parsed.success) return complete(failure("INVALID_INPUT"));
        for (const key of ["matchId", "roomId", "actionId"] as const)
          if (key in parsed.data) fields[key] = parsed.data[key as keyof typeof parsed.data];
        let outcome: unknown;
        phase("owner");
        switch (name) {
          case "room:subscribe": {
            const input = roomSubscriptionSchema.parse(parsed.data);
            if (!canSubscribe(`room:${input.roomId}`)) return complete(failure("RATE_LIMITED"));
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
            outcome = await (deps.privateRooms ?? deps.rooms).start(userId, parsed.data);
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
            if (!canSubscribe(`match:${input.matchId}`)) return complete(failure("RATE_LIMITED"));
            const result = await deps.membership.authorize(userId, input);
            outcome = result;
            if (result.ok) {
              await socket.join(`match:${input.matchId}`);
              cursors.get(socket)?.set(input.matchId, { seq: 0, stateVersion: -1 });
              if (presence) {
                const snapshot = await presence.subscribe(input.matchId);
                if (!(await stillAuthenticated())) {
                  complete(failure("UNAUTHENTICATED"));
                  socket.disconnect(true);
                  return;
                }
                const received: unknown = await socket
                  .timeout(deps.delivery!.ackTimeoutMs)
                  .emitWithAck("match:snapshot", snapshot);
                if (received !== snapshot.lastEventSeq)
                  throw new Error("Realtime acknowledgement invalid");
                cursors.get(socket)?.set(input.matchId, {
                  seq: snapshot.lastEventSeq,
                  stateVersion: snapshot.stateVersion,
                  role: snapshot.role,
                });
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
            outcome = await (deps.privateRooms ?? deps.matches).ready(
              userId,
              parsed.data,
              currentCorrelation(),
            );
            break;
          case "game:command":
            outcome = await (deps.privateRooms ?? deps.matches).command(
              userId,
              parsed.data,
              currentCorrelation(),
            );
            break;
          case "chat:send":
            outcome = deps.chat
              ? await deps.chat.port.send(userId, parsed.data, currentCorrelation())
              : failure("INTERNAL_ERROR");
            break;
          case "chat:list": {
            const input = incomingEvents["chat:list"].parse(parsed.data);
            if (!canSubscribe(`chat:${input.matchId}`)) return complete(failure("RATE_LIMITED"));
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
        phase("postAuthenticate");
        if (
          [
            "room:subscribe",
            "match:subscribe",
            "match:snapshot",
            "match:catchup",
            "matchmaking:found",
            "chat:list",
          ].includes(name) &&
          !(await stillAuthenticated())
        ) {
          complete(failure("UNAUTHENTICATED"));
          socket.disconnect(true);
          return;
        }
        complete(outcome);
      } catch {
        if (presence) socket.conn.close();
        complete(failure("INTERNAL_ERROR"));
      } finally {
        try {
          deps.telemetry?.emit("socket.completed", {
            ...fields,
            durationMs: performance.now() - started,
          });
        } catch {
          /* Observation cannot change an acknowledgement or durable effect. */
        }
      }
    }
    function canSubscribe(room: string) {
      return socket.rooms.has(room) || socket.rooms.size - 1 < policy.maxSubscriptions;
    }
    socket.onAny((name: string, ...args: unknown[]) => {
      const ack = args.at(-1);
      const payload = args[0];
      if (!available()) {
        if (typeof ack === "function") safeAck(ack as Ack, failure("INTERNAL_ERROR"));
        return;
      }
      withCorrelation(createCorrelation(), () => {
        const event = args.length === (typeof ack === "function" ? 2 : 1) ? name : "invalid";
        const work = beginWork(intentOperation(event), "order");
        void enqueue(
          socket,
          () => dispatch(event, payload, ack, work),
          false,
          withIntentSlot,
          true,
          work.phase,
        )
          .catch(() => {
            if (typeof ack === "function") safeAck(ack as Ack, failure("RATE_LIMITED"));
          })
          .finally(work.end);
      });
    });
  });
  async function fanout(input: unknown) {
    const event = matchDomainEventSchema.safeParse(input);
    if (!event.success || event.data.type !== "MATCH_CHANGED_V1" || !available() || !deps.delivery)
      throw new Error("Realtime delivery unavailable");
    const checkpoint = event.data.payload;
    return withCorrelation(createCorrelation(event.data.correlation), async () => {
      const matchId = event.data.aggregateId;
      const results = await Promise.allSettled(
        [...namespace.sockets.values()]
          .filter((s) => s.rooms.has(`match:${matchId}`))
          .map((socket) => {
            const work = beginWork("fanout", "tail");
            return enqueue(socket, async () => {
              if (!socket.connected) return;
              const identity = identities.get(socket);
              if (!identity) {
                socket.disconnect(true);
                return;
              }
              work.phase("authenticate");
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
              // A previously acknowledged view already covers older/duplicate wakeups.
              // Check inside the socket tail, after live authentication; never skip an
              // unacknowledged checkpoint or a newer state/role, even at the same seq.
              const cursor = cursors.get(socket)?.get(matchId);
              if (
                cursor &&
                cursor.seq >= checkpoint.lastEventSeq &&
                cursor.stateVersion >= checkpoint.stateVersion
              ) {
                work.phase("membership");
                const member = await deps.membership.authorize(identity.userId, {
                  schemaVersion: 1,
                  matchId,
                });
                if (!member.ok) {
                  if (member.error.code === "NOT_FOUND" || member.error.code === "FORBIDDEN") {
                    await socket.leave(`match:${matchId}`);
                    cursors.get(socket)?.delete(matchId);
                    if (deps.presence) socket.conn.close();
                    return;
                  }
                  throw new Error("Realtime membership unavailable");
                }
                if (member.value.role === cursor.role) return;
              }
              work.phase("projection");
              const result = await deps.delivery!.resync.catchup(identity.userId, {
                schemaVersion: 1,
                matchId,
                afterSeq: cursor?.seq ?? 0,
              });
              if (!result.ok) {
                if (result.error.code === "NOT_FOUND" || result.error.code === "FORBIDDEN") {
                  await socket.leave(`match:${matchId}`);
                  cursors.get(socket)?.delete(matchId);
                  // Presence retains lease identities until close. Do not leave an orphaned,
                  // renewable subscription outside the transport's cardinality bound.
                  if (deps.presence) socket.conn.close();
                  return;
                }
                throw new Error("Realtime projection unavailable");
              }
              if (!available()) throw new Error("Realtime delivery unavailable");
              // Session may expire while waiting for the database/earlier socket work.
              work.phase("postAuthenticate");
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
              // Cursor advances only after recipient acknowledgement. Loss/disconnect retries from durable state.
              work.phase("ack");
              const ack: unknown = await socket
                .timeout(deps.delivery!.ackTimeoutMs)
                .emitWithAck("match:snapshot", result.value.snapshot);
              if (ack !== result.value.snapshot.lastEventSeq)
                throw new Error("Realtime acknowledgement invalid");
              // The validated view covers these content-free invalidations. Deliver it
              // first so clients do not request the same locked projection again while
              // the covering snapshot is in flight. Event sequence order stays intact.
              for (const item of result.value.events) socket.emit("match:event", item);
              cursors.get(socket)?.set(matchId, {
                seq: result.value.snapshot.lastEventSeq,
                stateVersion: result.value.snapshot.stateVersion,
                role: result.value.snapshot.role,
              });
            }).finally(work.end);
          }),
      );
      if (results.some((r) => r.status === "rejected"))
        throw new Error("Realtime delivery incomplete");
    });
  }
  async function chatFanout(input: unknown) {
    const event = chatDeliverySchema.safeParse(input);
    if (!event.success || !available() || !deps.chat) throw new Error("Chat delivery unavailable");
    return withCorrelation(createCorrelation(event.data.correlation), async () => {
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
    });
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
  let drainWork: Promise<void> | undefined;
  return Object.freeze({
    workSnapshot() {
      const phases: Record<string, { active: number; maximumAgeMs: number }> = {};
      for (const work of activeDispatch) {
        const key = `${work.operation}/${work.phase}`;
        const entry = (phases[key] ??= { active: 0, maximumAgeMs: 0 });
        entry.active++;
        entry.maximumAgeMs = Math.max(entry.maximumAgeMs, performance.now() - work.began);
      }
      return {
        intents: withIntentSlot.snapshot(),
        disconnects: withDisconnectSlot.snapshot(),
        heartbeats: withHeartbeatSlot.snapshot(),
        pending: pending.size,
        handshakes: handshakes.size,
        phases,
        completedPhases: Object.fromEntries(
          [...completedPhases].map(([key, value]) => [key, { ...value }]),
        ),
      };
    },
    stopAdmission() {
      draining = true;
    },
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
    // A deadline is an observation, not cancellation of admitted durable work.
    // Resource owners must retain dependencies until this underlying drain settles,
    // even when close() has already reported its unchanged deadline failure.
    settled: () => drainWork ?? Promise.resolve(),
    close: () => {
      if (closing) return closing;
      drainWork = (async () => {
        draining = true;
        stopObserving?.();
        await Promise.allSettled([...engineChecks]);
        await Promise.allSettled([...handshakes]);
        await Promise.allSettled([...pending]);
        // Close and settle each transport's durable lease cleanup before the next.
        // Dumping every disconnect into the pool at once can exhaust acquisition
        // deadlines after otherwise successful admitted work has drained.
        for (const socket of namespace.sockets.values()) {
          socket.conn.close();
          await Promise.allSettled([...pending]);
        }
        await new Promise<void>((resolve) => io.close(() => resolve()));
        await Promise.allSettled([...pending]);
      })();
      closing = withDeadline(drainWork, drainTimeoutMs);
      return closing;
    },
  });
}

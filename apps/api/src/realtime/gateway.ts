import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import type { AuthSessions } from "../auth/index.js";
import type { RoomsPort } from "../rooms/index.js";
import type { MatchMembershipPort, MatchProcessingPort } from "../matches/index.js";
import type { createMatchmaking } from "../matchmaking/index.js";
import {
  handshakeSchema,
  incomingEvents,
  matchSubscriptionSchema,
  roomSubscriptionSchema,
  type IncomingEvent,
} from "./contracts.js";

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
  const io = new Server(httpServer, {
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
  io.of("/").use((_socket, next) => next(transportError(failure("INVALID_INPUT"))));
  const namespace = io.of("/v1");
  const identities = new WeakMap<
    Socket,
    { token: string; userId: string; sessionId: string; expiresAt: number }
  >();
  namespace.use(async (socket, next) => {
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
    socket.on("disconnect", () => clearTimeout(timer));

    async function dispatch(name: IncomingEvent, payload: unknown, ack: unknown) {
      if (typeof ack !== "function") return; // No unacknowledged mutation.
      const respond = ack as Ack;
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
            if (result.ok) await socket.join(`match:${input.matchId}`);
            outcome = result;
            break;
          }
          case "match:ready":
            outcome = await deps.matches.ready(userId, parsed.data, { requestId: randomUUID() });
            break;
          case "game:command":
            outcome = await deps.matches.command(userId, parsed.data, { requestId: randomUUID() });
            break;
          case "presence:ping":
            outcome = { ok: true, value: { schemaVersion: 1 } };
            break;
        }
        safeAck(respond, outcome);
      } catch {
        safeAck(respond, failure("INTERNAL_ERROR"));
      }
    }
    for (const name of Object.keys(incomingEvents) as IncomingEvent[])
      socket.on(name, (payload: unknown, ack: unknown) => void dispatch(name, payload, ack));
    socket.onAny((name, ...args: unknown[]) => {
      if (Object.hasOwn(incomingEvents, name)) return;
      const ack = args.at(-1);
      if (typeof ack === "function") safeAck(ack as Ack, failure("INVALID_INPUT"));
    });
  });
  return Object.freeze({
    close: () => new Promise<void>((resolve) => io.close(() => resolve())),
  });
}

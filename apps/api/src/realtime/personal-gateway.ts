import { Server as SocketServer } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { z } from "zod";
import { createErrorEnvelope } from "@hambazi/contracts";
import type { TransportAdmissionPolicy } from "@hambazi/config";
import type { AuthSessions } from "../auth/index.js";
import { personalCurrentSchema, type PersonalMatchPort } from "../matches/index.js";
import { createPeerResolver, type IpAdmission } from "./transport-admission.js";
import type { RealtimeRate } from "./gateway.js";
const handshake = z.strictObject({
  schemaVersion: z.literal(1),
  accessToken: z.string().min(1).max(4096),
});
const catchup = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: z.uuid(),
  afterSeq: z.number().int().min(0).max(2147483647),
});
export interface PersonalGatewayDependencies {
  coexistsWithKahroba?: boolean;
  sessions: Pick<AuthSessions, "authenticate">;
  matches: PersonalMatchPort;
  rate: RealtimeRate;
  ip: IpAdmission;
  policy: TransportAdmissionPolicy;
  trustedProxies: readonly string[];
  allowedOrigins: readonly string[];
  production: boolean;
}
/** Versioned, owner-authorized test adapter. It never reads state or chooses moves. */
export function createPersonalGateway(server: HttpServer, deps: PersonalGatewayDependencies) {
  const peer = createPeerResolver(deps.trustedProxies),
    active = new Set<Promise<unknown>>();
  let stopping = false,
    enginePending = 0,
    handshakes = 0;
  const io = new SocketServer(server, {
    path: "/v1/personal/socket.io",
    ...(deps.coexistsWithKahroba ? { destroyUpgrade: false } : {}),
    transports: ["websocket"],
    maxHttpBufferSize: 32768,
    pingInterval: 20000,
    pingTimeout: 10000,
    serveClient: false,
    connectTimeout: 10000,
    perMessageDeflate: false,
    allowRequest: (request, done) => {
      const origin = request.headers.origin,
        ip = peer(request);
      if (
        stopping ||
        !ip ||
        (deps.production && !peer.secure(request)) ||
        (origin !== undefined && !deps.allowedOrigins.includes(origin)) ||
        enginePending >= deps.policy.maxEngineInFlight
      )
        return done("FORBIDDEN", false);
      enginePending++;
      void deps
        .ip(ip, "engine")
        .then(
          (r) => done(r.allowed ? null : "RATE_LIMITED", r.allowed),
          () => done("INTERNAL_ERROR", false),
        )
        .finally(() => enginePending--);
    },
  });
  const namespace = io.of("/personal-v1");
  namespace.use((socket, next) => {
    if (
      stopping ||
      handshakes + namespace.sockets.size >= deps.policy.maxConnections ||
      active.size >= deps.policy.maxPendingTotal
    )
      return next(Object.assign(new Error("FORBIDDEN"), { data: { code: "FORBIDDEN" } }));
    handshakes++;
    const operation = (async () => {
      const p = handshake.safeParse(socket.handshake.auth);
      if (!p.success)
        return next(Object.assign(new Error("FORBIDDEN"), { data: { code: "FORBIDDEN" } }));
      const session = await deps.sessions.authenticate(p.data.accessToken);
      if (!session.ok)
        return next(
          Object.assign(new Error("UNAUTHENTICATED"), { data: { code: "UNAUTHENTICATED" } }),
        );
      if (!(await deps.rate(session.session.userId, "connect")).allowed)
        return next(Object.assign(new Error("RATE_LIMITED"), { data: { code: "RATE_LIMITED" } }));
      if (!(await deps.matches.current(session.session.userId)).ok || stopping)
        return next(Object.assign(new Error("FORBIDDEN"), { data: { code: "FORBIDDEN" } }));
      socket.data.token = p.data.accessToken;
      next();
    })()
      .catch(() => next(new Error("INTERNAL_ERROR")))
      .finally(() => {
        handshakes--;
        active.delete(operation);
      });
    active.add(operation);
  });
  namespace.on("connection", (socket) => {
    let pending = 0;
    socket.onAny((event: string) => {
      if (
        ![
          "personal:current",
          "personal:start",
          "personal:close",
          "game:command",
          "match:subscribe",
          "match:catchup",
        ].includes(event)
      )
        socket.disconnect(true);
    });
    for (const name of [
      "personal:current",
      "personal:start",
      "personal:close",
      "game:command",
      "match:subscribe",
      "match:catchup",
    ]) {
      socket.on(name, (input: unknown, ack: unknown) => {
        if (typeof ack !== "function") return;
        const respond = (v: unknown) => {
          try {
            ack(v);
          } catch {
            /* retry uses original ID */
          }
        };
        if (stopping || pending >= 1 || active.size >= deps.policy.maxPendingTotal)
          return respond(createErrorEnvelope("RATE_LIMITED"));
        pending++;
        const operation = (async () => {
          const auth = await deps.sessions.authenticate(String(socket.data.token));
          if (!auth.ok) {
            respond(auth);
            socket.disconnect(true);
            return;
          }
          const rate = await deps.rate(auth.session.userId, "event");
          if (!rate.allowed) {
            respond(
              createErrorEnvelope(rate.reason === "limited" ? "RATE_LIMITED" : "INTERNAL_ERROR"),
            );
            return;
          }
          const actor = auth.session.userId;
          if (name === "personal:current") {
            if (!personalCurrentSchema.safeParse(input).success)
              return respond(createErrorEnvelope("INVALID_INPUT"));
            return respond(await deps.matches.current(actor));
          }
          if (name === "personal:start") return respond(await deps.matches.start(actor, input));
          if (name === "personal:close") return respond(await deps.matches.close(actor, input));
          if (name === "game:command") return respond(await deps.matches.command(actor, input));
          if (name === "match:catchup") {
            const p = catchup.safeParse(input);
            if (!p.success) return respond(createErrorEnvelope("INVALID_INPUT"));
            const result = await deps.matches.read(actor, {
              schemaVersion: 1,
              matchId: p.data.matchId,
            });
            return respond(
              result.ok
                ? {
                    ok: true,
                    value: {
                      schemaVersion: 1,
                      mode: "SNAPSHOT",
                      events: [],
                      snapshot: result.value,
                    },
                  }
                : result,
            );
          }
          const result = await deps.matches.read(actor, input);
          const parsed = z
            .object({
              schemaVersion: z.literal(1),
              matchId: z.uuid(),
              role: z.enum(["PLAYER", "SPECTATOR"]),
            })
            .safeParse(result.ok ? result.value : null);
          respond(result.ok && parsed.success ? { ok: true, value: parsed.data } : result);
        })()
          .catch(() => respond(createErrorEnvelope("INTERNAL_ERROR")))
          .finally(() => {
            pending--;
            active.delete(operation);
          });
        active.add(operation);
      });
    }
  });
  return Object.freeze({
    stopAdmission() {
      stopping = true;
    },
    async close() {
      stopping = true;
      await Promise.allSettled([...active]);
      namespace.disconnectSockets(true);
      io.engine.close();
    },
  });
}

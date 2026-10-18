import process from "node:process";
import { createServer } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { Server } from "socket.io";
import { z } from "zod";
import { fixture, engine, ids, names, cases } from "./fixtures.mjs";
if (process.env.NODE_ENV === "production")
  throw new Error("Kahroba preview cannot run in production");
const token = `kahroba-local-${randomUUID()}`,
  matchId = "55555555-5555-4555-8555-555555555555";
let current = fixture(),
  version = 1,
  seq = 1,
  caseName = "initial",
  failNext = false,
  delayNext = false;
// Loopback-only lobby fixtures. Never imported by a production entry.
const lobbyRoomId = "77777777-7777-4777-8777-777777777777",
  lobbyCode = randomBytes(32).toString("base64url");
let lobbyMode = "host",
  lobbyCapacity = 2,
  lobbyInvites = 0,
  lobbyExpiresAt = Date.now() + 900000;
const lobbyActor = () => ids[0];
function lobbyRoom() {
  return {
    id: lobbyRoomId,
    gameId: "kahroba",
    hostUserId: lobbyMode === "guest" ? ids[1] : ids[0],
    capacity: lobbyCapacity,
    version: 3,
    status: lobbyMode === "expired" ? "EXPIRED" : lobbyMode === "full" ? "FULL" : "WAITING",
    expiresAt: lobbyMode === "expired" ? Date.now() - 1000 : lobbyExpiresAt,
    startedMatchId: null,
    members: (lobbyMode === "reference-layout"
      ? ids.slice(0, 3)
      : lobbyMode === "full"
        ? ids.slice(0, lobbyCapacity)
        : lobbyMode === "guest"
          ? ids.slice(0, 2)
          : ids.slice(0, 1)
    ).map((userId, seat) => ({ userId, seat, joinedAt: 1000, joinedVersion: seat + 1 })),
  };
}
const receipts = new Map(),
  commands = [];
function snapshot() {
  const view =
    current.role === "SPECTATOR"
      ? engine.getSpectatorView(current.state)
      : engine.getPlayerView(current.state, ids[0]);
  return {
    schemaVersion: 1,
    matchId,
    stateVersion: version,
    lastEventSeq: seq,
    status: current.state.phase === "GAME_OVER" ? "FINISHED" : "ACTIVE",
    role: current.role,
    gameId: "kahroba",
    engineVersion: current.failure ? "unsupported-v1" : "kahroba-v1",
    stateSchemaVersion: 1,
    rulesetVersion: "kahroba-base-v1",
    view,
  };
}
function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "http://127.0.0.1:4183",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}
const http = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.url === "/health") return send(res, 200, { ok: true });
  if (req.url === "/v1/auth/telegram-mini-app/registered-session-photo")
    return send(res, 200, {
      schemaVersion: 1,
      tokenType: "Bearer",
      accessToken: token,
      session: {
        schemaVersion: 1,
        sessionId: "11111111-1111-4111-8111-111111111111",
        userId: lobbyActor(),
        expiresAt: Math.floor(Date.now() / 1000) + 900,
      },
    });
  if (req.headers.authorization !== `Bearer ${token}`)
    return send(res, 401, { ok: false, error: { code: "UNAUTHENTICATED", retryable: false } });
  if (req.url === "/v1/me")
    return send(res, 200, {
      schemaVersion: 1,
      userId: lobbyActor(),
      displayName:
        lobbyMode === "long-name"
          ? "نام بسیار بلند آزمایشی با حروف فارسی و English 123"
          : lobbyMode === "guest"
            ? "حساب دوم آزمایشی"
            : "مهدی",
      publicHandle: "mehdi",
      version: 1,
      settings: { locale: "fa", theme: "dark" },
    });
  if (req.url === `/v1/kahroba/rooms/${lobbyRoomId}`) {
    if (lobbyMode === "forbidden" || lobbyMode === "unauthenticated")
      return send(res, lobbyMode === "forbidden" ? 403 : 401, {
        ok: false,
        error: {
          code: lobbyMode === "forbidden" ? "FORBIDDEN" : "UNAUTHENTICATED",
          retryable: false,
        },
      });
    return send(res, 200, { ok: true, schemaVersion: 1, room: lobbyRoom() });
  }
  if (req.url === `/v1/kahroba/rooms/${lobbyRoomId}/players`) {
    if (["forbidden", "unauthenticated"].includes(lobbyMode))
      return send(res, 403, { ok: false, error: { code: "FORBIDDEN", retryable: false } });
    return send(res, 200, {
      schemaVersion: 1,
      players: lobbyRoom().members.map((m) => ({ userId: m.userId, displayName: names[m.userId] })),
    });
  }
  if (req.url === `/v1/kahroba/rooms/${lobbyRoomId}/invite`) {
    if (req.method !== "GET") return send(res, 405, {});
    if (lobbyMode === "guest" || lobbyMode === "expired")
      return send(res, 404, { ok: false, error: { code: "NOT_FOUND", retryable: false } });
    lobbyInvites++;
    const room = lobbyRoom();
    return send(res, 200, {
      ok: true,
      schemaVersion: 2,
      invite: {
        roomId: room.id,
        expiresAt: room.expiresAt,
        startParam: `room_${lobbyCode}`,
        deepLink: `https://t.me/Hambazidev_bot?startapp=room_${lobbyCode}`,
      },
    });
  }
  if (req.url === "/__preview/lobby-stats") return send(res, 200, { lobbyInvites });
  if (req.url === "/__preview/meta")
    return send(res, 200, { schemaVersion: 1, names, cases, caseName });
  if (req.url === "/__preview/stats")
    return send(res, 200, {
      schemaVersion: 1,
      commands: commands.map((c) => ({
        actionId: c.actionId,
        expectedVersion: c.expectedVersion,
        type: c.command.type,
      })),
      version,
      seq,
    });
  let text = "";
  for await (const part of req) {
    text += part;
    if (text.length > 8192) return send(res, 413, {});
  }
  let body;
  try {
    body = JSON.parse(text || "{}");
  } catch {
    return send(res, 400, {});
  }
  if (req.url === "/v1/kahroba/room-invites/resolve") {
    if (body.startParam !== `room_${lobbyCode}` || lobbyMode === "expired")
      return send(res, 404, { ok: false, error: { code: "NOT_FOUND", retryable: false } });
    const { id, gameId, capacity, version, expiresAt, status } = lobbyRoom();
    return send(res, 200, {
      ok: true,
      schemaVersion: 1,
      room: { id, gameId, capacity, version, expiresAt, status },
    });
  }
  if (req.url === "/__preview/lobby") {
    const value = z
      .strictObject({
        mode: z.enum([
          "host",
          "guest",
          "full",
          "expired",
          "forbidden",
          "unauthenticated",
          "long-name",
          "reference-layout",
        ]),
        capacity: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(2),
      })
      .safeParse(body);
    if (!value.success) return send(res, 400, {});
    lobbyMode = value.data.mode;
    lobbyCapacity = value.data.capacity;
    lobbyInvites = 0;
    lobbyExpiresAt = Date.now() + 900000;
    return send(res, 200, { ok: true, schemaVersion: 1 });
  }
  if (req.url === "/__preview/case") {
    lobbyMode = "host";
    const parsed = z
      .strictObject({
        case: z.enum(cases),
        capacity: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(4),
      })
      .safeParse(body);
    if (!parsed.success) return send(res, 400, {});
    current = fixture(parsed.data.case, parsed.data.capacity);
    caseName = parsed.data.case;
    version++;
    seq++;
    receipts.clear();
    commands.length = 0;
    io.of("/v1").emit("match:snapshot", snapshot());
    return send(res, 200, { schemaVersion: 1, ok: true });
  }
  if (req.url === "/__preview/disconnect") {
    for (const socket of io.of("/v1").sockets.values()) socket.conn.close();
    return send(res, 200, { schemaVersion: 1, ok: true });
  }
  if (req.url === "/__preview/ambiguous") {
    failNext = true;
    return send(res, 200, { schemaVersion: 1, ok: true });
  }
  if (req.url === "/__preview/delay") {
    delayNext = true;
    return send(res, 200, { schemaVersion: 1, ok: true });
  }
  return send(res, 404, {});
});
const io = new Server(http, {
  path: "/v1/socket.io",
  cors: { origin: "http://127.0.0.1:4183" },
  maxHttpBufferSize: 65536,
});
io.of("/v1").use((socket, next) =>
  socket.handshake.auth.schemaVersion === 1 && socket.handshake.auth.accessToken === token
    ? next()
    : next(new Error("UNAUTHENTICATED")),
);
io.of("/v1").on("connection", (socket) => {
  const ok = (ack, value) => ack?.({ ok: true, value });
  socket.on("match:subscribe", (_, ack) => {
    ok(ack, { schemaVersion: 1, matchId, role: current.role });
    socket.emit("match:snapshot", snapshot());
  });
  socket.on("match:catchup", (_, ack) =>
    ok(ack, { schemaVersion: 1, mode: "SNAPSHOT", events: [], snapshot: snapshot() }),
  );
  socket.on("game:command", async (input, ack) => {
    const error = (code) =>
      ack?.({ ok: false, error: { code, retryable: code === "NETWORK_ERROR" } });
    const parsed = z
      .strictObject({
        schemaVersion: z.literal(1),
        matchId: z.literal(matchId),
        actionId: z.uuid(),
        expectedVersion: z.number().int().nonnegative(),
        command: z.json(),
      })
      .safeParse(input);
    if (!parsed.success) return error("INVALID_INPUT");
    const body = parsed.data,
      digest = JSON.stringify(body),
      prior = receipts.get(body.actionId);
    commands.push(body);
    if (prior) return prior.digest === digest ? ok(ack, prior.ack) : error("GAME_STATE_CONFLICT");
    if (current.role !== "PLAYER") return error("FORBIDDEN");
    if (body.expectedVersion !== version) return error("GAME_STATE_CONFLICT");
    try {
      const state = current.state,
        events = engine.execute(state, body.command, ids[0], {
          clock: { now: () => state.lastCommandAt + 1 },
          random: {
            nextInt: () => {
              throw new Error("No turn randomness");
            },
          },
          rules: state.rules,
        });
      current.state = events.reduce(engine.applyEvent, state);
    } catch (e) {
      return error(e.code ?? "INVALID_INPUT");
    }
    version++;
    seq++;
    const value = {
      schemaVersion: 1,
      matchId,
      actionId: body.actionId,
      stateVersion: version,
      lastEventSeq: seq,
      status: current.state.phase === "GAME_OVER" ? "FINISHED" : "ACTIVE",
    };
    receipts.set(body.actionId, { digest, ack: value });
    if (delayNext) {
      delayNext = false;
      await new Promise((r) => setTimeout(r, 700));
    }
    if (failNext) {
      failNext = false;
      return error("NETWORK_ERROR");
    }
    ok(ack, value);
    io.of("/v1").emit("match:snapshot", snapshot());
  });
});
http.listen(4184, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => io.close(() => http.close(() => process.exit(0))));

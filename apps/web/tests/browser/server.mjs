// Disposable synthetic transport fixture. Never imported by product code.
import { createServer } from "node:http";
import { Server } from "socket.io";
import { readFileSync } from "node:fs";
const goldens = JSON.parse(
  readFileSync(
    new URL(
      "../../../../packages/games/coup-engine/tests/fixtures/module-v1.json",
      import.meta.url,
    ),
  ),
).goldens;
const userId = () => goldens.WAITING_FOR_ACTION.players[state.viewerIndex].viewerId;
const roomId = "22222222-2222-4222-8222-222222222222";
const matchId = "33333333-3333-4333-8333-333333333333";
const ticketId = "44444444-4444-4444-8444-444444444444";
const code = "A".repeat(43);
const previewMode = process.env.HAMBAZI_PREVIEW_MODE === "1";
let state;
function reset() {
  state = {
    playable: true,
    modes: [{ id: "server-choice", title: "Server choice" }],
    profileVersion: 0,
    statsFailure: false,
    statsEmpty: false,
    displayName: "Test player",
    settings: { locale: "auto", theme: "system" },
    roomVersion: 1,
    roomStatus: "WAITING",
    ticketStatus: "SEARCHING",
    search: null,
    commands: [],
    chatMessages: [],
    chatCommands: {},
    chatFailure: false,
    snapshotVersion: 2,
    deadlineAt: Date.now() + 30000,
    role: "PLAYER",
    viewerIndex: 0,
    coupPhase: "WAITING_FOR_ACTION",
    failCreate: false,
    createIds: [],
    conflict: false,
  };
}
reset();
const game = () => ({
  id: "coup",
  slug: "coup",
  title: "Coup",
  minPlayers: 2,
  maxPlayers: 6,
  status: state.playable ? "ACTIVE" : "DISABLED",
  readiness: "NOT_IMPLEMENTED",
  descriptor: null,
  playable: state.playable,
  matchmakingEnabled: state.playable,
  privateRoomsEnabled: state.playable,
  chatEnabled: false,
  voiceEnabled: false,
  ...(state.modes === null ? {} : { matchmakingModes: state.modes }),
});
const room = () => ({
  id: roomId,
  gameId: "coup",
  hostUserId: userId(),
  capacity: 2,
  version: state.roomVersion,
  status: state.roomStatus,
  expiresAt: Date.now() + 600000,
  startedMatchId: state.roomStatus === "STARTED" ? matchId : null,
  members: [
    { userId: userId(), seat: 0, joinedAt: 1000, joinedVersion: 1 },
    ...(state.roomStatus === "FULL"
      ? [{ userId: ticketId, seat: 1, joinedAt: 2000, joinedVersion: 2 }]
      : []),
  ],
});
const ticket = () => ({
  schemaVersion: 1,
  ticketId,
  status: state.ticketStatus,
  expiresAt: Date.now() + 600000,
  matchId: state.ticketStatus === "MATCHED" ? matchId : null,
});
const snapshot = () => ({
  schemaVersion: 1,
  matchId,
  stateVersion: state.snapshotVersion,
  lastEventSeq: state.snapshotVersion,
  status: state.coupPhase === "GAME_OVER" ? "FINISHED" : "ACTIVE",
  role: state.role,
  gameId: "coup",
  engineVersion: "coup-v1",
  stateSchemaVersion: 4,
  rulesetVersion: state.rulesetVersion ?? "coup-provisional-complete-v1",
  view:
    state.invalidView ??
    (state.role === "SPECTATOR"
      ? {
          ...goldens[state.coupPhase].spectator,
          deadlineAt:
            goldens[state.coupPhase].spectator.deadlineAt === null ? null : state.deadlineAt,
        }
      : {
          ...goldens[state.coupPhase].players[state.viewerIndex],
          deadlineAt:
            goldens[state.coupPhase].players[state.viewerIndex].deadlineAt === null
              ? null
              : state.deadlineAt,
        }),
});
const ok = (value) => ({ ok: true, value });
const http = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:4173");
  res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") {
    res.end();
    return;
  }
  let text = "";
  for await (const chunk of req) text += chunk;
  const body = text ? JSON.parse(text) : {};
  const send = (value) => res.end(JSON.stringify(value));
  if (req.url === "/health") return send({ ok: true });
  if (previewMode) {
    if (req.url?.startsWith("/__test/")) {
      res.statusCode = 404;
      return send({ ok: false, error: { code: "NOT_FOUND" } });
    }
    if (req.url?.startsWith("/v1/auth/telegram-mini-app")) {
      if (new URLSearchParams(body.initData).get("preview") !== "synthetic") {
        res.statusCode = 401;
        return send({ ok: false, error: { code: "UNAUTHENTICATED" } });
      }
    } else if (
      req.url?.startsWith("/v1/") &&
      req.headers.authorization !== "Bearer synthetic-access"
    ) {
      res.statusCode = 401;
      return send({ ok: false, error: { code: "UNAUTHENTICATED" } });
    }
  }
  if (req.url === "/__test/reset") {
    reset();
    return send({ ok: true });
  }
  if (req.url === "/__test/state") {
    if (req.method === "POST") Object.assign(state, body);
    return send(state);
  }
  if (req.url === "/__test/disconnect") {
    for (const socket of io.of("/v1").sockets.values()) socket.conn.close();
    return send({ ok: true });
  }
  if (req.url === "/__test/snapshot") {
    for (const socket of io.of("/v1").sockets.values())
      socket.emit("match:snapshot", snapshot(), () => {});
    return send({ ok: true });
  }
  if (req.url === "/__test/match-event") {
    state.snapshotVersion++;
    for (const socket of io.of("/v1").sockets.values())
      socket.emit("match:event", {
        schemaVersion: 1,
        eventId: crypto.randomUUID(),
        matchId,
        seq: state.snapshotVersion,
        stateVersion: state.snapshotVersion,
        type: "MATCH_INVALIDATED_V1",
        payload: {},
      });
    return send({ ok: true });
  }
  if (req.url === "/v1/auth/telegram-mini-app/account")
    return send({
      schemaVersion: 1,
      account: {
        schemaVersion: 1,
        userId: userId(),
        displayName: body.displayName,
        publicHandle: "test_12345",
      },
      startParam: `room_${code}`,
    });
  if (req.url === "/v1/auth/telegram-mini-app")
    return send({
      schemaVersion: 1,
      tokenType: "Bearer",
      accessToken: "synthetic-access",
      session: {
        schemaVersion: 1,
        userId: userId(),
        sessionId: userId(),
        expiresAt: Math.floor(Date.now() / 1000) + 900,
      },
    });
  if (req.url === "/v1/auth/logout") return send({ schemaVersion: 1, ok: true });
  if (req.url?.startsWith("/v1/me/stats") || req.url?.startsWith("/v1/leaderboards/")) {
    if (state.statsFailure) {
      res.statusCode = 503;
      return send({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "private server diagnostics", retryable: true },
      });
    }
    const url = new URL(req.url, "http://127.0.0.1:4174");
    const period = url.searchParams.get("period") === "weekly" ? "week:2026-09-28" : "all_time";
    if (url.pathname === "/v1/me/stats")
      return send({
        schemaVersion: 1,
        period,
        games: state.statsEmpty ? [] : [{ gameId: "coup", completed: "3", wins: "2", losses: "1" }],
      });
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return send({
      schemaVersion: 1,
      gameId: "coup",
      metric: "wins",
      period,
      entries: state.statsEmpty
        ? []
        : [
            {
              userId: offset ? "55555555-5555-4555-8555-555555555555" : userId(),
              displayName: offset ? "Next player" : "<img src=x onerror=alert(1)> plain name",
              rank: offset ? "51" : "1",
              wins: offset ? "0" : "2",
            },
          ],
      nextOffset: !state.statsEmpty && offset === 0 ? 50 : null,
    });
  }
  if (req.url === "/v1/me") {
    if (req.method === "PATCH") {
      if (state.conflict) {
        res.statusCode = 409;
        return send({
          ok: false,
          error: { code: "PROFILE_CONFLICT", message: "private debug text", retryable: false },
        });
      }
      state.displayName = body.patch.displayName;
      state.settings = body.patch.settings;
      state.profileVersion++;
      return send({
        schemaVersion: 1,
        commandId: body.commandId,
        appliedVersion: state.profileVersion,
      });
    }
    return send({
      schemaVersion: 1,
      userId: userId(),
      displayName: state.displayName,
      publicHandle: "test_12345",
      version: state.profileVersion,
      settings: state.settings,
    });
  }
  if (req.url === "/v1/games") return send({ schemaVersion: 1, games: [game()] });
  if (req.url === "/v1/games/coup") return send({ schemaVersion: 1, game: game() });
  if (req.url === "/v1/room-invites/resolve") {
    const r = room();
    return send({
      ok: true,
      schemaVersion: 1,
      room: {
        id: r.id,
        gameId: r.gameId,
        capacity: r.capacity,
        version: r.version,
        status: "WAITING",
        expiresAt: r.expiresAt,
      },
    });
  }
  if (req.url === "/v1/rooms") {
    state.createIds.push(body.commandId);
    if (state.failCreate) {
      state.failCreate = false;
      res.statusCode = 503;
      return send({ ok: false, error: { code: "NETWORK_ERROR", retryable: true } });
    }
    return send({
      ok: true,
      schemaVersion: 1,
      commandId: body.commandId,
      roomId,
      appliedVersion: 1,
    });
  }
  if (req.url === `/v1/rooms/${roomId}`) return send({ ok: true, schemaVersion: 1, room: room() });
  if (req.url === `/v1/rooms/${roomId}/invite`)
    return send({
      ok: true,
      schemaVersion: 1,
      invite: {
        roomId,
        expiresAt: Date.now() + 600000,
        startParam: `room_${code}`,
        deepLink: `https://t.me/TestBot/app?startapp=room_${code}`,
      },
    });
  res.statusCode = 404;
  send({ ok: false, error: { code: "NOT_FOUND", retryable: false } });
});
const io = new Server(http, { path: "/v1/socket.io", cors: { origin: "http://127.0.0.1:4173" } });
if (previewMode)
  io.of("/v1").use((socket, next) => {
    if (socket.handshake.auth?.accessToken !== "synthetic-access")
      return next(new Error("UNAUTHENTICATED"));
    next();
  });
io.of("/v1").on("connection", (socket) =>
  socket.onAny((event, input, ack) => {
    state.commands.push({
      event,
      input:
        event === "matchmaking:admit"
          ? { ticketId: input.ticketId }
          : event === "chat:send"
            ? { commandId: input.commandId, matchId: input.matchId }
            : input,
    });
    if (event === "matchmaking:search") {
      state.search = input;
      return ack(ok(ticket()));
    }
    if (event === "matchmaking:status") return ack(ok(ticket()));
    if (event === "matchmaking:cancel") {
      if (state.ticketStatus !== "MATCHED") state.ticketStatus = "CANCELLED";
      return ack(ok(ticket()));
    }
    if (event === "matchmaking:found")
      return ack(
        ok({
          schemaVersion: 1,
          ticketId,
          matchId,
          admissionToken: "synthetic-admission",
          expiresAt: Date.now() + 30000,
        }),
      );
    if (event === "matchmaking:admit") return ack(ok({ schemaVersion: 1, matchId }));
    if (event === "room:subscribe") return ack({ ok: true, schemaVersion: 1, room: room() });
    if (event.startsWith("room:")) {
      if (event === "room:start") state.roomStatus = "STARTING";
      state.roomVersion++;
      return ack({
        ok: true,
        schemaVersion: 1,
        commandId: input.commandId,
        roomId,
        appliedVersion: state.roomVersion,
      });
    }
    if (event === "chat:list") {
      if (input.matchId !== matchId)
        return ack({ ok: false, error: { code: "NOT_FOUND", retryable: false } });
      const history = state.chatMessages.filter(
        (message) =>
          (input.beforeSeq === undefined || message.seq < input.beforeSeq) &&
          (input.afterSeq === undefined || message.seq > input.afterSeq),
      );
      const latest = input.afterSeq === undefined;
      const messages = latest ? history.slice(-50) : history.slice(0, 50);
      return ack(
        ok({
          schemaVersion: 1,
          matchId,
          role: state.role,
          canSend: state.role === "PLAYER",
          messageLimit: 500,
          messages,
          lastSeq: state.chatMessages.at(-1)?.seq ?? 0,
          hasMore: history.length > 50,
        }),
      );
    }
    if (event === "chat:send") {
      if (input.matchId !== matchId)
        return ack({ ok: false, error: { code: "NOT_FOUND", retryable: false } });
      if (state.role !== "PLAYER")
        return ack({ ok: false, error: { code: "FORBIDDEN", retryable: false } });
      const text = input.text.normalize("NFC").trim();
      let message = state.chatCommands[input.commandId];
      if (message && message.text !== text)
        return ack({ ok: false, error: { code: "CHAT_CONFLICT", retryable: false } });
      if (!message) {
        message = {
          schemaVersion: 1,
          matchId,
          messageId: crypto.randomUUID(),
          userId: userId(),
          seq: (state.chatMessages.at(-1)?.seq ?? 0) + 1,
          text,
          createdAt: Date.now(),
        };
        state.chatMessages.push(message);
        state.chatCommands[input.commandId] = message;
      }
      if (state.chatFailure) {
        state.chatFailure = false;
        return ack({ ok: false, error: { code: "NETWORK_ERROR", retryable: true } });
      }
      ack(ok(message));
      socket.emit("chat:message", message, () => {});
      return;
    }
    if (event === "match:subscribe") {
      socket.emit("match:snapshot", snapshot(), () => {});
      return ack(ok({ schemaVersion: 1, matchId, role: state.role }));
    }
    if (event === "match:catchup")
      return ack(ok({ schemaVersion: 1, mode: "SNAPSHOT", events: [], snapshot: snapshot() }));
    if (event === "game:command") {
      state.snapshotVersion++;
      if (state.nextPhase) {
        state.coupPhase = state.nextPhase;
        state.nextPhase = null;
      }
      ack(
        ok({
          schemaVersion: 1,
          actionId: input.actionId,
          matchId,
          stateVersion: state.snapshotVersion,
          lastEventSeq: state.snapshotVersion,
          status: state.coupPhase === "GAME_OVER" ? "FINISHED" : "ACTIVE",
        }),
      );
      socket.emit("match:snapshot", snapshot(), () => {});
      return;
    }
    return ack({ ok: false, error: { code: "INVALID_INPUT", retryable: false } });
  }),
);
http.listen(4174, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => io.close(() => http.close()));

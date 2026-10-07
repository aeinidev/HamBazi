import process from "node:process";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { request as httpRequest } from "node:http";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { setInterval, clearInterval } from "node:timers";
import { io } from "socket.io-client";
import { createCapacityWorkTracker } from "../../../../infra/scripts/capacity-diagnostics.mjs";
import { createMatchSequence } from "@hambazi/contracts";
import { coupPlayerViewSchema, coupSpectatorViewSchema } from "@hambazi/coup-engine";
import { matchSnapshotSchema, matchDeliveryEventSchema } from "../../dist/matches/index.js";
import {
  latencyHistogram,
  normalCapacityGates,
  capacityPopulationGates,
  reconcileMatch,
  capacityHttpRetryAllowed,
} from "../../../../infra/scripts/capacity-model.mjs";

// No target URL input, production auth or serialized PlayerView diagnostics.
const base = "http://127.0.0.1:4174",
  control = "http://127.0.0.1:4176";
const restLatency = latencyHistogram(),
  commandLatency = latencyHistogram(),
  fanoutLatency = latencyHistogram(),
  reconnectLatency = latencyHistogram();
const normalReconnectLatency = latencyHistogram();
const normalReconnectCounts = { reconnectAttempts: 0, reconnectSuccess: 0, reconnectFailed: 0 };
const normalGateFailures = [];
const counts = {
  offered: 0,
  accepted: 0,
  missed: 0,
  missedBusy: 0,
  missedGeneratorLag: 0,
  retries: 0,
  conflicts: 0,
  duplicatesChecked: 0,
  reconciledMatches: 0,
  reconciledReceipts: 0,
  snapshots: 0,
  duplicateEvents: 0,
  gaps: 0,
  sentBytes: 0,
  receivedBytes: 0,
  reconnectAttempts: 0,
  reconnectSuccess: 0,
  reconnectFailed: 0,
  reconnectRecovered: 0,
  connectRateLimited: 0,
  connectInternalError: 0,
  connectUnauthenticated: 0,
  connectTransportError: 0,
  sessionRenewals: 0,
  serviceRestarts: 0,
  recoveryReceiptChecks: 0,
  timerWaits: 0,
  idleTimerRecoveries: 0,
  errors: 0,
  httpRejectedStatus: null,
  httpRejectedRoute: null,
  httpRetries: 0,
  socketRejectedEvent: null,
};
const actors = [],
  pairs = [],
  stages = [],
  holds = [];
const inFlight = createCapacityWorkTracker();
let failureCode = null,
  recovering = false;
let firstWait = null;
let waitAuditInput = null;
let measuring = null,
  admissionTail = Promise.resolve();
let stage = "guard",
  stopping = false,
  draining = false,
  started,
  profile,
  actorTarget,
  matchTarget = 0,
  progress;
function fail(code) {
  throw new Error(code);
}
function capture(error) {
  const first = failureCode === null;
  failureCode ??= /^CAPACITY_[A-Z_]{1,80}$/.test(error?.message ?? "")
    ? error.message
    : "CAPACITY_TRANSPORT_FAILED";
  if (first) {
    try {
      process.send?.(
        {
          type: "first-failure",
          stage,
          reason: failureCode,
          operation: error?.capacityOperation ?? null,
          connected: typeof error?.capacityConnected === "boolean" ? error.capacityConnected : null,
        },
        () => {},
      );
    } catch {
      // Diagnostic loss cannot replace the original failure.
    }
  }
}
function unwrap(result) {
  if (!result?.ok)
    fail(
      /^[A-Z_]{1,50}$/.test(result?.error?.code ?? "")
        ? `CAPACITY_ACK_${result.error.code}`
        : "CAPACITY_ACK_FAILED",
    );
  return result.value ?? result;
}
async function json(
  path,
  body,
  actor,
  privateControl = false,
  attempt = 0,
  began = performance.now(),
) {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  counts.sentBytes += serialized === undefined ? 0 : Buffer.byteLength(serialized);
  // Actual bound loopback source addresses exercise IP admission without forwarded headers.
  const response = await new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      `${privateControl ? control : base}${path}`,
      {
        method: serialized === undefined ? "GET" : "POST",
        localAddress: privateControl ? "127.0.0.1" : (actor?.sourceIp ?? "127.0.0.1"),
        headers: {
          "content-type": "application/json",
          ...(serialized === undefined ? {} : { "content-length": Buffer.byteLength(serialized) }),
          ...(actor?.token ? { authorization: `Bearer ${actor.token}` } : {}),
        },
      },
      (incoming) => {
        const chunks = [];
        let bytes = 0;
        incoming.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) outgoing.destroy(new Error("CAPACITY_HTTP_TOO_LARGE"));
          else chunks.push(chunk);
        });
        incoming.on("error", reject);
        incoming.on("end", () =>
          resolve({ status: incoming.statusCode, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    outgoing.setTimeout(10000, () => outgoing.destroy(new Error("CAPACITY_HTTP_TIMEOUT")));
    outgoing.on("error", reject);
    outgoing.end(serialized);
  });
  const text = response.text;
  counts.receivedBytes += Buffer.byteLength(text);
  let retryable = false;
  if (response.status === 503) {
    try {
      const value = JSON.parse(text);
      retryable = value?.ok === false && value?.error?.retryable === true;
    } catch {
      // Invalid/non-contract error bodies cannot authorize a retry.
    }
  }
  if (capacityHttpRetryAllowed(response.status, attempt, body, privateControl, retryable)) {
    counts.httpRetries++;
    await delay(100 * 2 ** attempt);
    return json(path, body, actor, privateControl, attempt + 1, began);
  }
  if (!privateControl) {
    const elapsed = performance.now() - began;
    restLatency.add(elapsed);
    measuring?.rest.add(elapsed);
  }
  if (response.status < 200 || response.status >= 300) {
    counts.httpRejectedStatus = response.status;
    counts.httpRejectedRoute = privateControl
      ? "CONTROL"
      : path === "/v1/rooms"
        ? "ROOM_CREATE"
        : /^\/v1\/rooms\/[^/]+\/invite$/.test(path)
          ? "ROOM_INVITE"
          : path.startsWith("/v1/rooms/")
            ? "ROOM_READ"
            : path.startsWith("/v1/auth/")
              ? "AUTH"
              : "PRODUCT_READ";
    fail("CAPACITY_HTTP_FAILED");
  }
  return JSON.parse(text);
}
async function request(actor, event, body) {
  counts.sentBytes += Buffer.byteLength(JSON.stringify(body));
  let result;
  try {
    result = await actor.socket.timeout(10000).emitWithAck(event, body);
  } catch {
    const error = new Error("CAPACITY_SOCKET_ACK_FAILED");
    error.capacityOperation = event;
    error.capacityConnected = actor.socket.connected;
    throw error;
  }
  counts.receivedBytes += Buffer.byteLength(JSON.stringify(result));
  try {
    return unwrap(result);
  } catch (error) {
    counts.socketRejectedEvent = [
      "room:join",
      "room:start",
      "matchmaking:search",
      "matchmaking:status",
      "matchmaking:found",
      "matchmaking:admit",
      "match:subscribe",
      "match:catchup",
      "match:ready",
      "game:command",
    ].includes(event)
      ? event
      : "UNKNOWN";
    error.capacityOperation = counts.socketRejectedEvent;
    throw error;
  }
}
function apply(actor, input) {
  const parsed = matchSnapshotSchema.safeParse(input);
  if (!parsed.success) fail("CAPACITY_SNAPSHOT_INVALID");
  const snapshot = parsed.data;
  if (snapshot.matchId !== actor.matchId) return;
  if (snapshot.view !== null) {
    const schema = snapshot.role === "PLAYER" ? coupPlayerViewSchema : coupSpectatorViewSchema;
    const view = schema.safeParse(snapshot.view);
    if (!view.success || (snapshot.role === "PLAYER" && view.data.viewerId !== actor.userId))
      fail("CAPACITY_PRIVACY_FAILED");
  }
  const action = actor.sequence.snapshot(snapshot);
  if (action === "INVALID") fail("CAPACITY_CURSOR_INVALID");
  if (action === "APPLY") {
    actor.snapshot = snapshot;
    actor.observedAt = performance.now();
  }
  counts.snapshots++;
}
async function sync(actor) {
  if (!actor.matchId || !actor.socket.connected) return;
  if (actor.syncing) return actor.syncPromise;
  const generation = actor.generation,
    matchId = actor.matchId;
  actor.syncing = true;
  const work = (async () => {
    try {
      const value = await request(actor, "match:catchup", {
        schemaVersion: 1,
        matchId,
        afterSeq: actor.sequence.cursor().lastEventSeq,
      });
      if (generation === actor.generation && matchId === actor.matchId)
        apply(actor, value.snapshot);
    } catch (error) {
      if (generation === actor.generation && matchId === actor.matchId) throw error;
    } finally {
      if (generation === actor.generation) {
        actor.syncing = false;
        actor.syncPromise = null;
      }
    }
  })();
  actor.syncPromise = work;
  inFlight.add(work);
  return work;
}
async function connected(actor) {
  actor.generation = (actor.generation ?? 0) + 1;
  actor.syncing = false;
  actor.syncPromise = null;
  actor.socket?.removeAllListeners();
  actor.socket?.disconnect();
  actor.snapshot = null;
  actor.sequence = actor.matchId ? createMatchSequence(actor.matchId) : null;
  const socket = (actor.socket = io(`${base}/v1`, {
    path: "/v1/socket.io",
    transports: ["websocket"],
    transportOptions: { websocket: { localAddress: actor.sourceIp } },
    auth: { schemaVersion: 1, accessToken: actor.token },
    extraHeaders: { Origin: "http://127.0.0.1:4173" },
    autoConnect: false,
    reconnection: false,
    timeout: 10000,
  }));
  socket.on("match:snapshot", (input, ack) => {
    if (actor.socket !== socket) return;
    try {
      counts.receivedBytes += Buffer.byteLength(JSON.stringify(input));
      apply(actor, input);
      if (typeof ack === "function") ack(input.lastEventSeq);
    } catch (error) {
      capture(error);
      counts.errors++;
      stopping = true;
    }
  });
  socket.on("match:event", (input) => {
    if (actor.socket !== socket) return;
    counts.receivedBytes += Buffer.byteLength(JSON.stringify(input));
    const parsed = matchDeliveryEventSchema.safeParse(input);
    if (!parsed.success) {
      capture(new Error("CAPACITY_EVENT_INVALID"));
      counts.errors++;
      stopping = true;
      return;
    }
    if (input.matchId !== actor.matchId) return;
    const action = actor.sequence.event(parsed.data);
    if (action === "DUPLICATE") counts.duplicateEvents++;
    if (action === "GAP") counts.gaps++;
    if (!stopping && !recovering && (action === "GAP" || action === "ACCEPT"))
      void sync(actor).catch((error) => {
        capture(error);
        counts.errors++;
        stopping = true;
      });
  });
  socket.on("chat:message", (input, ack) => {
    if (typeof ack === "function") ack(input.messageId);
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", (error) => {
      const counter = new Map([
        ["RATE_LIMITED", "connectRateLimited"],
        ["INTERNAL_ERROR", "connectInternalError"],
        ["UNAUTHENTICATED", "connectUnauthenticated"],
      ]).get(error?.data?.code);
      counts[counter ?? "connectTransportError"]++;
      reject(new Error("CAPACITY_CONNECT_FAILED"));
    });
    socket.connect();
  });
  if (actor.matchId) {
    await request(actor, "match:subscribe", { schemaVersion: 1, matchId: actor.matchId });
    await sync(actor);
  }
}
async function actor(index) {
  const synthetic = await json("/actor", {}, null, true);
  const person = {
    ...synthetic,
    sourceIp: `127.1.${Math.floor(index / 250)}.${(index % 250) + 1}`,
    token: null,
    matchId: null,
    syncing: false,
  };
  actors.push(person);
  await json(
    "/v1/auth/telegram-mini-app/account",
    {
      schemaVersion: 1,
      commandId: randomUUID(),
      displayName: person.displayName,
      initData: person.initData,
    },
    person,
  );
  await login(person);
  await connected(person);
  return person;
}
async function login(person) {
  const issued = await json(
    "/v1/auth/telegram-mini-app",
    {
      schemaVersion: 1,
      commandId: randomUUID(),
      initData: person.initData,
    },
    person,
  );
  person.token = issued.accessToken;
  person.userId = issued.session.userId;
  person.renewAt = performance.now() + 600000;
  person.initData = null;
}
async function until(check, timeout = 10000, diagnostic) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (stopping || performance.now() > deadline) {
      if (!stopping && firstWait === null) firstWait = diagnostic?.() ?? { kind: "OTHER" };
      fail("CAPACITY_WAIT_FAILED");
    }
    await delay(10);
  }
}
async function snapshots(pair, version, status) {
  await until(
    () =>
      pair.people.every(
        (p) =>
          p.snapshot &&
          p.snapshot.stateVersion >= version &&
          (!status || p.snapshot.status === status),
      ),
    10000,
    () => {
      waitAuditInput = { matchId: pair.matchId, version };
      return {
        kind: "SNAPSHOTS",
        recipients: pair.people.length,
        disconnected: pair.people.filter((p) => !p.socket.connected).length,
        absent: pair.people.filter((p) => !p.snapshot).length,
        stale: pair.people.filter((p) => p.snapshot && p.snapshot.stateVersion < version).length,
        wrongStatus: pair.people.filter((p) => status && p.snapshot?.status !== status).length,
        syncing: pair.people.filter((p) => p.syncing).length,
        recipientVersionLag: pair.people.map((p) => version - (p.snapshot?.stateVersion ?? -1)),
      };
    },
  );
}
async function openMatch(pair) {
  await admitPair(pair);
}
async function pairedTickets(pair) {
  // Keep each pair adjacent in the real FIFO. Waiting for its Match, subscriptions
  // and readiness does not belong in this enqueue critical section.
  const admission = admissionTail.then(async () => {
    const tickets = [];
    for (const person of pair.people)
      tickets.push(
        await request(person, "matchmaking:search", {
          schemaVersion: 1,
          commandId: randomUUID(),
          gameId: "coup",
          mode: "standard",
          capacity: 2,
        }),
      );
    return tickets;
  });
  admissionTail = admission.catch(() => {});
  return admission;
}
async function admitPair(pair) {
  for (const person of pair.people) {
    person.matchId = null;
    await connected(person);
  }
  let matchId;
  if (pair.mode === "PRIVATE") {
    const host = pair.people[0],
      guest = pair.people[1];
    const created = unwrap(
      await json(
        "/v1/rooms",
        { schemaVersion: 1, commandId: randomUUID(), gameId: "coup", capacity: 2 },
        host,
      ),
    );
    const room = unwrap(await json(`/v1/rooms/${created.roomId}`, undefined, host)).room;
    const invite = unwrap(await json(`/v1/rooms/${room.id}/invite`, undefined, host)).invite;
    const joined = await request(guest, "room:join", {
      schemaVersion: 1,
      commandId: randomUUID(),
      roomId: room.id,
      expectedVersion: room.version,
      inviteCode: invite.startParam.slice(5),
    });
    await request(host, "room:start", {
      schemaVersion: 1,
      commandId: randomUUID(),
      roomId: room.id,
      expectedVersion: joined.appliedVersion,
    });
    matchId = unwrap(await json(`/v1/rooms/${room.id}`, undefined, host)).room.startedMatchId;
  } else {
    const tickets = await pairedTickets(pair);
    for (const [i, person] of pair.people.entries()) {
      let view;
      for (let n = 0; n < 100; n++) {
        view = await request(person, "matchmaking:status", {
          schemaVersion: 1,
          ticketId: tickets[i].ticketId,
        });
        if (view.status === "MATCHED") break;
        await delay(100);
      }
      if (view.status !== "MATCHED") fail("CAPACITY_MATCHMAKING_TIMEOUT");
      const found = await request(person, "matchmaking:found", {
        schemaVersion: 1,
        ticketId: tickets[i].ticketId,
      });
      await request(person, "matchmaking:admit", {
        schemaVersion: 1,
        ticketId: found.ticketId,
        admissionToken: found.admissionToken,
      });
      if (matchId && matchId !== found.matchId) fail("CAPACITY_ROSTER_FAILED");
      matchId = found.matchId;
    }
  }
  pair.matchId = matchId;
  pair.accepted = [];
  for (const person of pair.people) {
    person.matchId = matchId;
    person.sequence = createMatchSequence(matchId);
    person.snapshot = null;
    await request(person, "match:subscribe", { schemaVersion: 1, matchId });
    await sync(person);
  }
  for (const person of pair.people) {
    const ack = await request(person, "match:ready", {
      schemaVersion: 1,
      actionId: randomUUID(),
      matchId,
      expectedVersion: person.snapshot.stateVersion,
    });
    await snapshots(pair, ack.stateVersion);
  }
  await snapshots(pair, 0, "ACTIVE");
}
async function reconcile(pair) {
  let audit;
  for (let n = 0; n < 100; n++) {
    audit = await json(`/audit/match/${pair.matchId}`, undefined, null, true);
    if (
      audit.applications === 1 &&
      (audit.matchType === "MATCHMAKING" || audit.roomStatus === "CLOSED")
    )
      break;
    await delay(100);
  }
  audit.receipts = await receipts(pair);
  if (!reconcileMatch(audit, pair.accepted)) fail("CAPACITY_RECONCILIATION_FAILED");
  counts.reconciledMatches++;
  counts.reconciledReceipts += pair.accepted.length;
}
async function receipts(pair) {
  const saved = [];
  for (let i = 0; i < pair.accepted.length; i += 100)
    saved.push(
      ...(await json(
        "/audit/commands",
        {
          matchId: pair.matchId,
          actionIds: pair.accepted.slice(i, i + 100).map((r) => r.actionId),
        },
        null,
        true,
      )),
    );
  return saved;
}
function intent(pair) {
  for (const type of ["SELECT_CARD_TO_LOSE", "DECLARE_COUP", "DECLARE_INCOME"])
    for (const person of pair.people) {
      const command = person.snapshot?.view?.legalCommands?.find((c) => c.type === type);
      if (command) return { person, command };
    }
  return null;
}
async function move(pair, duplicate = false, attempt = 0, began = performance.now()) {
  // Setup/recovery can outlast a turn. Wait for the real timer job and public view;
  // retrying an expired PlayerView cannot make its command valid.
  const waitUntil = performance.now() + 10000;
  const expired = () =>
    pair.people.some(
      (person) =>
        person.snapshot?.status === "ACTIVE" &&
        person.snapshot.view?.deadlineAt !== null &&
        person.snapshot.view?.deadlineAt <= Date.now(),
    );
  if (expired()) counts.timerWaits++;
  while (expired()) {
    if (stopping || performance.now() > waitUntil) fail("CAPACITY_TIMER_RECOVERY_TIMEOUT");
    await Promise.all(pair.people.map(sync));
    if (expired()) await delay(100);
  }
  if (pair.people.every((person) => person.snapshot?.status === "FINISHED")) {
    await reconcile(pair);
    if (draining) return;
    if (stopping) return;
    await openMatch(pair);
  }
  const chosen = intent(pair);
  if (!chosen) fail("CAPACITY_NO_LEGAL_COMMAND");
  const envelope = {
    schemaVersion: 1,
    actionId: randomUUID(),
    matchId: pair.matchId,
    expectedVersion: chosen.person.snapshot.stateVersion,
    command: chosen.command,
  };
  let ack;
  try {
    ack = await request(chosen.person, "game:command", envelope);
  } catch (error) {
    if (error?.message === "CAPACITY_ACK_GAME_STATE_CONFLICT" && attempt < 5) {
      counts.conflicts++;
      await Promise.all(pair.people.map(sync));
      return move(pair, duplicate, attempt + 1, began);
    }
    counts.retries++;
    ack = await request(chosen.person, "game:command", envelope);
  }
  const commandMs = performance.now() - began;
  commandLatency.add(commandMs);
  measuring?.command.add(commandMs);
  counts.accepted++;
  pair.accepted.push({ actionId: ack.actionId, stateVersion: ack.stateVersion });
  if (duplicate) {
    const replay = await request(chosen.person, "game:command", envelope);
    if (JSON.stringify(replay) !== JSON.stringify(ack)) fail("CAPACITY_DUPLICATE_FAILED");
    counts.duplicatesChecked++;
  }
  await snapshots(pair, ack.stateVersion);
  const fanoutMs = Math.max(...pair.people.map((p) => p.observedAt)) - began;
  fanoutLatency.add(fanoutMs);
  measuring?.dispatchToAllRecipients.add(fanoutMs);
  if (ack.status === "FINISHED") {
    await reconcile(pair);
    if (!draining && !stopping) await openMatch(pair);
  }
}
async function load(name, seconds, rate) {
  stage = name;
  measuring = {
    rest: latencyHistogram(),
    command: latencyHistogram(),
    dispatchToAllRecipients: latencyHistogram(),
  };
  const began = performance.now(),
    before = { ...counts },
    tasks = new Set();
  let index = 0,
    next = began;
  let minConnectedClients = actors.length,
    minActiveMatches = pairs.length,
    maxActiveMatches = 0;
  while (next < began + seconds * 1000) {
    if (stopping) fail("CAPACITY_INTERRUPTED");
    const remaining = next - performance.now();
    if (remaining > 0) await delay(remaining);
    counts.offered++;
    const active = pairs.filter((p) =>
      p.people.every((person) => person.socket.connected && person.snapshot?.status === "ACTIVE"),
    ).length;
    minConnectedClients = Math.min(
      minConnectedClients,
      actors.filter((person) => person.socket.connected).length,
    );
    minActiveMatches = Math.min(minActiveMatches, active);
    maxActiveMatches = Math.max(maxActiveMatches, active);
    const pair = pairs[index++ % pairs.length];
    if (pair.busy) {
      counts.missed++;
      counts.missedBusy++;
    } else if (performance.now() - next > 1000 / rate) {
      counts.missed++;
      counts.missedGeneratorLag++;
    } else {
      pair.busy = true;
      const offered = counts.offered;
      const task = move(pair, offered % 20 === 0)
        .then(async () => {
          if (offered % 10 === 0) await json("/v1/me", undefined, pair.people[0]);
        })
        .catch((error) => {
          capture(error);
          counts.errors++;
          stopping = true;
        })
        .finally(() => {
          pair.busy = false;
          tasks.delete(task);
        });
      tasks.add(task);
      inFlight.add(task);
    }
    next += 1000 / rate;
  }
  await Promise.all(tasks);
  while (performance.now() < began + seconds * 1000)
    await delay(Math.max(1, Math.ceil(began + seconds * 1000 - performance.now())));
  if (stopping) fail("CAPACITY_LOAD_FAILED");
  const elapsedSeconds = (performance.now() - began) / 1000;
  stages.push({
    name,
    requestedSeconds: seconds,
    elapsedSeconds,
    offered: counts.offered - before.offered,
    accepted: counts.accepted - before.accepted,
    missed: counts.missed - before.missed,
    missedBusy: counts.missedBusy - before.missedBusy,
    missedGeneratorLag: counts.missedGeneratorLag - before.missedGeneratorLag,
    targetCommandsPerSecond: rate,
    acceptedCommandsPerSecond: (counts.accepted - before.accepted) / elapsedSeconds,
    minConnectedClients,
    minActiveMatches,
    maxActiveMatches,
    latency: Object.fromEntries(
      Object.entries(measuring).map(([key, histogram]) => [key, histogram.result()]),
    ),
  });
  measuring = null;
}
async function storm(scope = "stress") {
  stage = "reconnect-storm";
  recovering = true;
  const versions = pairs.map((p) => p.people[0].snapshot.stateVersion);
  actors.forEach((p) => p.socket.disconnect());
  await delay(200);
  const outcomes = await Promise.allSettled(
    actors.map(async (person) => {
      counts.reconnectAttempts++;
      if (scope === "normal") normalReconnectCounts.reconnectAttempts++;
      const began = performance.now();
      try {
        await connected(person);
        const pairIndex = pairs.findIndex((p) => p.people.includes(person));
        if (
          person.matchId &&
          (!person.snapshot ||
            person.snapshot.role !== "PLAYER" ||
            person.snapshot.stateVersion < versions[pairIndex])
        )
          fail("CAPACITY_RECONNECT_STATE_FAILED");
        const elapsed = performance.now() - began;
        reconnectLatency.add(elapsed);
        counts.reconnectSuccess++;
        if (scope === "normal") {
          normalReconnectLatency.add(elapsed);
          normalReconnectCounts.reconnectSuccess++;
        }
      } catch (error) {
        counts.reconnectFailed++;
        if (scope === "normal") normalReconnectCounts.reconnectFailed++;
        throw error;
      }
    }),
  );
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  if (rejected) {
    if (
      scope !== "normal" ||
      !profile.targets ||
      (100 * normalReconnectCounts.reconnectSuccess) / normalReconnectCounts.reconnectAttempts <
        profile.targets.reconnectSuccessPercent
    )
      throw rejected.reason;
    // Restore failed normal-wave clients without reclassifying their first attempt as success.
    for (const person of actors) {
      if (!person.socket.connected) {
        await connected(person);
        counts.reconnectRecovered++;
      }
    }
  }
  // Every recipient catches up to the durable cursor after the simultaneous connection writes.
  for (const pair of pairs) {
    const audit = await json(`/audit/match/${pair.matchId}`, undefined, null, true);
    await Promise.all(pair.people.map(sync));
    await until(() =>
      pair.people.every(
        (p) =>
          p.snapshot.stateVersion >= audit.stateVersion &&
          p.snapshot.lastEventSeq >= audit.lastEventSeq,
      ),
    );
  }
  recovering = false;
}
async function renew() {
  for (const person of actors) {
    if (performance.now() < person.renewAt) continue;
    person.initData = (
      await json("/actor/refresh", { telegramUserId: person.telegramUserId }, null, true)
    ).initData;
    await login(person);
    await connected(person);
    counts.sessionRenewals++;
  }
}
async function restartService(service) {
  stage = `${service}-recovery`;
  recovering = true;
  await until(() => actors.every((person) => !person.syncing));
  await delay(200);
  await new Promise((resolve, reject) => {
    const id = randomUUID();
    const complete = (message) => {
      if (message.type === "fault-complete" && message.id === id) {
        clearInterval(deadline);
        process.off("message", complete);
        resolve();
      }
    };
    const deadline = setInterval(() => {
      clearInterval(deadline);
      process.off("message", complete);
      reject(new Error("CAPACITY_FAULT_TIMEOUT"));
    }, 45000);
    process.on("message", complete);
    process.send?.({ type: "fault", service, id });
  });
  // Existing role-scoped adapters have bounded reconnect backoff up to two seconds.
  await delay(2200);
  await storm();
  for (const pair of pairs) {
    const saved = await receipts(pair);
    if (
      saved.length !== pair.accepted.length ||
      pair.accepted.some(
        (receipt) =>
          !saved.some(
            (row) =>
              row.actionId === receipt.actionId && row.resultingVersion === receipt.stateVersion,
          ),
      )
    )
      fail("CAPACITY_RECOVERY_RECEIPT_LOST");
    counts.recoveryReceiptChecks += saved.length;
  }
  counts.serviceRestarts++;
}
async function main(input) {
  if (process.env.TEST_CAPACITY_MODE !== "isolated") fail("CAPACITY_GUARD_FAILED");
  profile = input.profile;
  started = performance.now();
  progress = setInterval(
    () =>
      process.send?.({
        type: "progress",
        phase: stage,
        elapsedSeconds: Math.floor((performance.now() - started) / 1000),
        accepted: counts.accepted,
        missed: counts.missed,
        connected: actors.filter((person) => person.socket?.connected).length,
        requested: actorTarget,
        activeMatches: pairs.filter((pair) =>
          pair.people.every((person) => person.snapshot?.status === "ACTIVE"),
        ).length,
        requestedMatches: matchTarget,
      }),
    30000,
  );
  async function accounts(target) {
    stage = "accounts";
    actorTarget = target;
    let nextActor = actors.length;
    await Promise.allSettled(
      Array.from({ length: Math.min(8, target) }, async () => {
        while (nextActor < target && !stopping) {
          try {
            await actor(nextActor++);
          } catch (error) {
            stopping = true;
            capture(error);
            throw error;
          }
        }
      }),
    );
    if (stopping || actors.length !== target) fail(failureCode ?? "CAPACITY_ACCOUNTS_FAILED");
  }
  await accounts(profile.connectionOnly || profile.stressOnly ? profile.ccu : profile.normalCcu);
  // Real Engine.IO pongs renew presence; no additional artificial ping workload is injected.
  if (profile.connectionOnly) {
    for (let wave = 0; wave < 2; wave++) {
      stage = "connection-hold";
      const began = performance.now();
      let minConnectedClients = profile.ccu;
      while (performance.now() - began < profile.soakSeconds * 1000) {
        minConnectedClients = Math.min(
          minConnectedClients,
          actors.filter((person) => person.socket.connected).length,
        );
        if (stopping || minConnectedClients !== profile.ccu) fail("CAPACITY_CONNECTION_LOST");
        await delay(100);
      }
      holds.push({ elapsedSeconds: (performance.now() - began) / 1000, minConnectedClients });
      if (wave === 0) await storm();
    }
    process.send?.({
      type: "result",
      report: {
        counts,
        holds,
        correctnessPassed:
          counts.errors === 0 &&
          counts.reconnectAttempts === profile.ccu &&
          counts.reconnectSuccess === profile.ccu &&
          holds.every((hold) => hold.minConnectedClients === profile.ccu),
        minimumSoakPassed: false,
        latencyTargetsPassed: null,
        reconnectLatency: reconnectLatency.result(),
        limitations: [
          "Authenticated idle sockets and one reconnect wave only; no active Match, game-command rate, final SLO or two-hour capacity acceptance.",
          "Distinct synthetic loopback source IPs; shared NAT authentication throughput is not measured.",
        ],
      },
    });
    return;
  }
  async function admit(target) {
    stage = "admission";
    matchTarget = target;
    while (pairs.length < target) {
      const batch = [];
      for (let i = pairs.length; i < Math.min(pairs.length + 8, target); i++) {
        batch.push({
          people: actors.slice(i * 2, i * 2 + 2),
          mode: i % 2 === 0 ? "PRIVATE" : "MATCHMAKING",
          busy: false,
        });
      }
      pairs.push(...batch);
      await Promise.all(batch.map(openMatch));
    }
  }
  let normalPopulationPassed = null,
    normalTargetsPassed = null;
  if (!profile.stressOnly) {
    await admit(profile.normalMatches);
    if (profile.smoke) {
      stage = "idle-timer";
      const pair = pairs[0];
      const deadline = pair.people[0].snapshot.view?.deadlineAt;
      if (!Number.isSafeInteger(deadline)) fail("CAPACITY_TIMER_DEADLINE_MISSING");
      // Cross the retained sixty-second deadline without any client game command.
      await delay(Math.max(0, deadline - Date.now() + 10));
      await until(() =>
        pair.people.every(
          (person) =>
            person.snapshot?.status === "ACTIVE" && person.snapshot.view?.deadlineAt > deadline,
        ),
      );
      counts.idleTimerRecoveries++;
    }
    await load("warmup", profile.warmupSeconds, profile.normalCommandsPerSecond);
    if (profile.cpuProfile) await json("/capacity/cpu/start", {}, null, true);
    await load("normal-load", profile.normalLoadSeconds, profile.normalCommandsPerSecond);
    normalPopulationPassed = profile.smoke
      ? null
      : capacityPopulationGates(stages, profile, ["normal-load"]);
    if (normalPopulationPassed === false) {
      normalGateFailures.push("CAPACITY_NORMAL_POPULATION_FAILED");
      if (!profile.diagnostic) fail("CAPACITY_NORMAL_POPULATION_FAILED");
    }
    await storm("normal");
    normalTargetsPassed = profile.smoke
      ? null
      : normalCapacityGates(
          stages,
          normalReconnectCounts,
          profile.targets,
          normalReconnectLatency.result(),
        );
    // Do not spend two hours on a stress soak when the approved normal gate already fails.
    if (normalTargetsPassed === false) {
      normalGateFailures.push("CAPACITY_NORMAL_TARGETS_FAILED");
      if (!profile.diagnostic) fail("CAPACITY_NORMAL_TARGETS_FAILED");
    }
  }
  await accounts(profile.ccu);
  await admit(profile.matches);
  if (profile.cpuProfile && profile.stressOnly) await json("/capacity/cpu/start", {}, null, true);
  if (profile.stressOnly) await load("warmup", profile.warmupSeconds, profile.commandsPerSecond);
  await load("2x-load", profile.loadSeconds, profile.commandsPerSecond);
  for (let i = 0; i < profile.stormWaves; i++) await storm();
  let soakElapsedSeconds = 0;
  if (!profile.diagnostic) {
    stage = "worker-recovery";
    await json("/worker/stop", {}, null, true);
    const workerRestart = delay(1000).then(() => json("/worker/start", {}, null, true));
    await Promise.all([load("worker-offline", 2, profile.commandsPerSecond), workerRestart]);
    stage = "api-recovery";
    recovering = true;
    await json("/api/restart", {}, null, true);
    await storm();
    await restartService("postgres");
    await restartService("redis");
    let remaining = profile.soakSeconds;
    const soakStarted = performance.now();
    while (remaining > 0) {
      await renew();
      const seconds = Math.min(60, remaining);
      await load("soak", seconds, profile.commandsPerSecond);
      remaining -= seconds;
    }
    soakElapsedSeconds = (performance.now() - soakStarted) / 1000;
  }
  stage = "final-reconciliation";
  draining = true;
  // Drain every current table to a real result; these extra intents are outside offered-rate windows.
  for (const pair of pairs) {
    const old = counts.reconciledMatches;
    for (let i = 0; i < 80 && counts.reconciledMatches === old; i++) await move(pair, true);
    if (counts.reconciledMatches === old) fail("CAPACITY_FINISH_FAILED");
  }
  process.send?.({
    type: "result",
    report: {
      counts,
      stages,
      correctnessPassed: counts.errors === 0 && counts.reconciledReceipts === counts.accepted,
      requestedRateSustained: stages
        .filter((s) => s.name === "2x-load" || s.name === "soak")
        .every((s) => s.missed === 0),
      latencyTargetsPassed: normalTargetsPassed,
      normalPopulationPassed,
      normalGateFailures,
      workloadTargetsPassed: capacityPopulationGates(
        stages,
        profile,
        profile.stressOnly
          ? ["2x-load"]
          : profile.diagnostic
            ? ["normal-load", "2x-load"]
            : undefined,
      ),
      normalReconnect: {
        ...normalReconnectCounts,
        latency: normalReconnectLatency.result(),
      },
      stressLatencyTargetsApplied: false,
      soakElapsedSeconds,
      minimumSoakPassed: !profile.smoke && !profile.diagnostic && soakElapsedSeconds >= 7200,
      latency: {
        rest: restLatency.result(),
        command: commandLatency.result(),
        dispatchToAllRecipients: fanoutLatency.result(),
        reconnect: reconnectLatency.result(),
      },
      limitations: [
        ...(profile.diagnostic
          ? [
              profile.stressOnly
                ? "Independent stress diagnostic omits normal validation, service restart scenarios and the two-hour soak. Full capacity acceptance remains incomplete."
                : "Focused normal/stress diagnostic continues after failed normal gates; service restart scenarios and the two-hour soak are omitted. Full capacity acceptance remains incomplete.",
            ]
          : []),
        "Loopback synthetic release composition; production gameplay remains disabled.",
        "Dispatch-to-recipient latency includes command processing; it is not isolated commit-to-fanout timing.",
        "Profile decisions must have an owner record; no hosting or production-release approval is implied.",
        ...(profile.diagnostic
          ? []
          : [
              "Worker/API/DB/Redis restart exercised; offered commands paused during DB/Redis restarts.",
            ]),
        "Extended outage, unknown commit injection and Bot takeover capacity require separate evidence.",
        "Two-player tables, paired matchmaking enqueues serialized with admission/setup overlap, only income/coup/card-loss intents; no public network or chat load.",
      ],
    },
  });
}
process.once("SIGTERM", () => {
  stopping = true;
});
process.once("disconnect", () => {
  stopping = true;
});
process.once("message", (input) => {
  void main(input)
    .catch(async (error) => {
      capture(error);
      stopping = true;
      clearInterval(progress);
      // Settle admitted commands/reads before reporting failure and closing their sockets.
      // Teardown must not manufacture pool/transaction failures or lose late accepted receipts.
      await inFlight.settle();
      if (waitAuditInput) {
        try {
          firstWait.durable = await json("/capacity/wait", waitAuditInput, null, true);
        } catch {
          firstWait.auditUnavailable = true;
        }
      }
      process.send?.({
        type: "failed",
        stage,
        reason: failureCode ?? "CAPACITY_TRANSPORT_FAILED",
        firstWait,
        counts,
        stages,
        normalReconnect: { ...normalReconnectCounts, latency: normalReconnectLatency.result() },
        normalGateFailures,
        holds,
        reconnectLatency: reconnectLatency.result(),
      });
      process.exitCode = 1;
    })
    .finally(async () => {
      clearInterval(progress);
      try {
        // Measured reconnect storms remain simultaneous. Final fixture teardown
        // stops server admission and drains durable disconnects before client exit.
        await json("/capacity/drain", {}, null, true);
      } catch {
        process.send?.({ type: "driver-cleanup-failed" });
        process.exitCode = 1;
      }
      for (const person of actors) {
        person.socket?.removeAllListeners();
        person.socket?.disconnect();
        person.token = null;
        person.initData = null;
        person.snapshot = null;
      }
      process.disconnect?.();
    });
});

// Disposable capacity fixture only: fixed aggregate dimensions, never error content.
import { latencyHistogram } from "./capacity-model.mjs";
const owners = [
  "auth",
  "users",
  "games",
  "rooms",
  "matches",
  "chat",
  "leaderboard",
  "outbox",
  "database",
  "realtime",
];
const operations = [
  "execute",
  "transaction",
  "consumeOnce",
  "rate:create",
  "rate:read",
  "rate:invite",
  "query:commit",
  "query:statement",
  "callback:execute",
  "callback:transaction",
  "callback:consumeOnce",
  "pool:connect",
  "rate:event",
  "rate:connect",
  "projection:snapshot",
  "projection:catchup",
  "session:authenticate",
  "reconnect:connect",
  "reconnect:renew",
  "reconnect:disconnect",
  "reconnect:reconcile",
  "reconnect:timeout",
  "redis:admission",
];
const codes = [
  "DATABASE_TRANSACTION_CONFLICT",
  "DATABASE_UNIQUE_CONFLICT",
  "DATABASE_REFERENCE_CONFLICT",
  "DATABASE_RECORD_NOT_FOUND",
  "DATABASE_OPERATION_FAILED",
  "DATABASE_CLOSED",
  "RATE_UNAVAILABLE",
  "RATE_LIMITED",
  "REDIS_WINDOW_INVALID",
  "REDIS_COMMAND_ABORTED",
  "REDIS_COMMAND_REJECTED",
  "OTHER",
  "GAME_STATE_CONFLICT",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_INPUT",
  "INCOMPATIBLE_GAME_VERSION",
  "INTERNAL_ERROR",
  "UNAUTHENTICATED",
  "PRISMA_P2028",
  "PRISMA_P2024",
  "PRISMA_P2034",
  "PG_40001",
  "PG_40P01",
  "PG_23505",
  "PG_23503",
  "PG_23514",
  "PG_25P02",
  "PG_57014",
  "PG_08006",
  "PG_53300",
  "PG_55P03",
  "PG_POOL_ACQUIRE_TIMEOUT",
  "PG_POOL_CONNECT_TIMEOUT",
  "PG_POOL_CLOSED",
];

function poolFailureCode(error) {
  try {
    // Exact constants from pinned pg-pool; no message or original error escapes.
    const known = {
      "timeout exceeded when trying to connect": "PG_POOL_ACQUIRE_TIMEOUT",
      "Connection terminated due to connection timeout": "PG_POOL_CONNECT_TIMEOUT",
      "Cannot use a pool after calling end on the pool": "PG_POOL_CLOSED",
    };
    const message = error?.message;
    if (Object.hasOwn(known, message)) return known[message];
  } catch {
    /* Fixed fallback only. */
  }
  return "OTHER";
}

export function createCapacityWorkTracker() {
  const pending = new Set();
  return {
    add(work) {
      pending.add(work);
      const remove = () => pending.delete(work);
      void work.then(remove, remove);
      return work;
    },
    async settle() {
      // An admitted operation can start a follow-up read before it settles.
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}

export function observeCapacityGame(game) {
  const work = {};
  const wrapped = { ...game };
  for (const name of ["initialize", "restore", "project", "execute", "automation", "automate"]) {
    if (typeof game[name] !== "function") continue;
    const entry = (work[name] = { count: 0, totalMs: 0, maximumMs: 0 });
    wrapped[name] = function (...args) {
      const began = performance.now();
      try {
        return game[name].apply(this, args);
      } finally {
        const ms = performance.now() - began;
        entry.count++;
        entry.totalMs += ms;
        entry.maximumMs = Math.max(entry.maximumMs, ms);
      }
    };
  }
  return {
    game: Object.freeze(wrapped),
    result: () =>
      Object.fromEntries(Object.entries(work).map(([key, value]) => [key, { ...value }])),
  };
}

export function capacityDatabaseActivity(rows) {
  const result = {
    active: 0,
    idle: 0,
    idleInTransaction: 0,
    other: 0,
    waitingOnLock: 0,
    waitingOnClient: 0,
    waitingOnOther: 0,
    blocked: 0,
    maximumTransactionMs: 0,
  };
  for (const row of rows) {
    const count =
      Number.isSafeInteger(row.connections) && row.connections >= 0 ? row.connections : 0;
    const state =
      row.state === "active"
        ? "active"
        : row.state === "idle"
          ? "idle"
          : row.state === "idle in transaction"
            ? "idleInTransaction"
            : "other";
    result[state] += count;
    if (row.wait_event_type === "Lock") result.waitingOnLock += count;
    else if (row.wait_event_type === "Client") result.waitingOnClient += count;
    else if (row.wait_event_type !== null) result.waitingOnOther += count;
    if (Number.isSafeInteger(row.blocked) && row.blocked >= 0 && row.blocked <= count)
      result.blocked += row.blocked;
    if (Number.isFinite(row.maximum_transaction_ms) && row.maximum_transaction_ms >= 0)
      result.maximumTransactionMs = Math.max(
        result.maximumTransactionMs,
        row.maximum_transaction_ms,
      );
  }
  return result;
}

export function capacityDeliveryActivity(jobs, nowMs) {
  const matches = new Map();
  let unknownMatchJobs = 0;
  let maximumActiveAgeMs = 0;
  for (const job of jobs) {
    const id = job.data?.aggregateId;
    if (typeof id === "string") matches.set(id, (matches.get(id) ?? 0) + 1);
    else unknownMatchJobs++;
    if (Number.isFinite(job.processedOn))
      maximumActiveAgeMs = Math.max(maximumActiveAgeMs, nowMs - job.processedOn);
  }
  return {
    observedActiveJobs: jobs.length,
    activeMatches: matches.size,
    maximumJobsPerMatch: Math.max(0, ...matches.values()),
    unknownMatchJobs,
    maximumActiveAgeMs,
  };
}

export function capacityCpuSummary(profile) {
  const samples = {
    prisma: 0,
    validation: 0,
    coup: 0,
    api: 0,
    socket: 0,
    postgres: 0,
    redis: 0,
    node: 0,
    wasm: 0,
    gc: 0,
    idle: 0,
    other: 0,
  };
  const callers = {
    matchProjection: 0,
    matchWrite: 0,
    presence: 0,
    membership: 0,
    auth: 0,
    users: 0,
    rooms: 0,
    other: 0,
  };
  const nodes = new Map(profile.nodes.map((entry) => [entry.id, entry]));
  const parents = new Map();
  for (const entry of profile.nodes)
    for (const child of entry.children ?? []) parents.set(child, entry.id);
  function caller(entry) {
    const visited = new Set();
    while (entry && !visited.has(entry)) {
      visited.add(entry);
      const url = typeof entry.callFrame.url === "string" ? entry.callFrame.url : "";
      if (url.includes("/matches/infrastructure/repositories/resync.")) return "matchProjection";
      if (url.includes("/matches/infrastructure/repositories/reconnect.")) return "presence";
      if (url.includes("/matches/infrastructure/repositories/processing.")) return "matchWrite";
      if (url.includes("/matches/infrastructure/repositories/membership.")) return "membership";
      if (url.includes("/apps/api/") && url.includes("/auth/")) return "auth";
      if (url.includes("/apps/api/") && url.includes("/users/")) return "users";
      if (url.includes("/apps/api/") && url.includes("/rooms/")) return "rooms";
      entry = nodes.get(parents.get(entry.id));
    }
    return "other";
  }
  for (const entry of profile.nodes) {
    const url = typeof entry.callFrame.url === "string" ? entry.callFrame.url : "";
    const functionName =
      typeof entry.callFrame.functionName === "string" ? entry.callFrame.functionName : "";
    const group =
      functionName === "(garbage collector)"
        ? "gc"
        : functionName === "(idle)"
          ? "idle"
          : url.startsWith("wasm:") || /^wasm-function\[\d+\]$/.test(functionName)
            ? "wasm"
            : url.includes("@prisma") || url.includes("/prisma/")
              ? "prisma"
              : url.includes("/zod/") || url.includes("/zod@")
                ? "validation"
                : url.includes("coup-engine/")
                  ? "coup"
                  : url.includes("socket.io") || url.includes("engine.io") || url.includes("/ws/")
                    ? "socket"
                    : url.includes("/pg/") || url.includes("/pg-pool/")
                      ? "postgres"
                      : url.includes("/redis/") || url.includes("@redis")
                        ? "redis"
                        : url.includes("/apps/api/")
                          ? "api"
                          : url.startsWith("node:")
                            ? "node"
                            : "other";
    samples[group] +=
      Number.isSafeInteger(entry.hitCount) && entry.hitCount >= 0 ? entry.hitCount : 0;
    callers[caller(entry)] +=
      Number.isSafeInteger(entry.hitCount) && entry.hitCount >= 0 ? entry.hitCount : 0;
  }
  const elapsed = profile.endTime - profile.startTime;
  return {
    samples,
    callers,
    durationMicros: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0,
  };
}

export function capacityFailureKey(message) {
  try {
    if (
      !message ||
      Object.keys(message).length !== 4 ||
      message.type !== "capacity-failure" ||
      !owners.includes(message.owner) ||
      !operations.includes(message.operation) ||
      !codes.includes(message.code)
    )
      return null;
    return `${message.owner}/${message.operation}/${message.code}`;
  } catch {
    return null;
  }
}

export function observeCapacityOutcome(owner, operation, run, emit) {
  return async function (...args) {
    const result = await run.apply(this, args);
    let code;
    try {
      if (result?.allowed === false)
        code = result.reason === "limited" ? "RATE_LIMITED" : "RATE_UNAVAILABLE";
      else if (result?.ok === false && codes.includes(result.error?.code)) code = result.error.code;
      if (code) {
        const message = { type: "capacity-failure", owner, operation, code };
        if (capacityFailureKey(message)) emit(message);
      }
    } catch {
      /* Observation cannot replace a port result or expose its contents. */
    }
    return result;
  };
}

export function capacityAutomationObservation(message) {
  try {
    return (
      message?.type === "capacity-automation" &&
      Object.keys(message).length === 3 &&
      ["OBSOLETE_STATE", "SINGLE_ADVANCE", "OTHER_CHECKPOINT"].includes(message.outcome) &&
      Number.isFinite(message.durationMs) &&
      message.durationMs >= 0
    );
  } catch {
    return false;
  }
}

export function observeCapacityAutomation(run, emit) {
  return async function (...args) {
    const began = performance.now();
    const result = await run.apply(this, args);
    try {
      const expected = args[0]?.expectedStateVersion;
      // One successful command advances one version. A returned checkpoint more
      // than one version ahead proves this job's version was already obsolete.
      const outcome =
        result.stateVersion > expected + 1
          ? "OBSOLETE_STATE"
          : result.stateVersion === expected + 1
            ? "SINGLE_ADVANCE"
            : "OTHER_CHECKPOINT";
      const message = {
        type: "capacity-automation",
        outcome,
        durationMs: performance.now() - began,
      };
      if (capacityAutomationObservation(message)) emit(message);
    } catch {
      /* Observation cannot alter a result or expose the intent/checkpoint. */
    }
    return result;
  };
}

export function observeCapacityAdmissionRedis(prototype, emit) {
  const original = prototype.eval;
  function report(code) {
    try {
      emit({ type: "capacity-failure", owner: "realtime", operation: "redis:admission", code });
    } catch {
      /* Observation cannot alter admission. */
    }
  }
  function evalCommand(...args) {
    // Select only this known key prefix; never retain the key, script or arguments.
    const observed = args[1]?.keys?.[0]?.startsWith("hambazi:transport-rate:v1:") === true;
    const result = original.apply(this, args);
    if (!observed) return result;
    return result.then(
      (reply) => {
        if (Array.isArray(reply) && reply.length === 2 && reply[0] === -1 && reply[1] === 0)
          report("REDIS_WINDOW_INVALID");
        return reply;
      },
      (error) => {
        let code = "REDIS_COMMAND_REJECTED";
        try {
          if (error?.name === "AbortError") code = "REDIS_COMMAND_ABORTED";
        } catch {
          /* Fixed fallback only. */
        }
        report(code);
        throw error;
      },
    );
  }
  prototype.eval = evalCommand;
  return () => {
    if (prototype.eval === evalCommand) prototype.eval = original;
  };
}

export function observeCapacityDatabase(database, emit) {
  const work = new Map();
  return {
    ...database,
    capacityWorkSnapshot() {
      return Object.fromEntries(
        [...work].map(([key, value]) => [key, { ...value, duration: value.duration.result() }]),
      );
    },
    forModule(owner) {
      const scope = database.forModule(owner);
      function report(operation, error) {
        let code = "OTHER";
        try {
          if (codes.includes(error?.code)) code = error.code;
          else if (codes.includes(`PRISMA_${error?.code}`)) code = `PRISMA_${error.code}`;
          else code = poolFailureCode(error);
        } catch {
          /* Only fixed codes escape hostile getters. */
        }
        if (owners.includes(owner)) {
          try {
            emit({ type: "capacity-failure", owner, operation, code });
          } catch {
            /* Observation must not change the original operation failure. */
          }
        }
      }
      async function observed(operation, args) {
        const key = owners.includes(owner) ? `${owner}/${operation}` : `database/${operation}`;
        if (!work.has(key))
          work.set(key, {
            active: 0,
            maximumActive: 0,
            callbackActive: 0,
            maximumCallbackActive: 0,
            completed: 0,
            maximumAdmissionMs: 0,
            duration: latencyHistogram(),
          });
        const state = work.get(key),
          began = performance.now();
        state.active++;
        state.maximumActive = Math.max(state.maximumActive, state.active);
        const callbackIndex = operation === "consumeOnce" ? 2 : 0;
        const original = args[callbackIndex];
        args[callbackIndex] = async (...input) => {
          state.maximumAdmissionMs = Math.max(state.maximumAdmissionMs, performance.now() - began);
          state.callbackActive++;
          state.maximumCallbackActive = Math.max(state.maximumCallbackActive, state.callbackActive);
          try {
            return await original(...input);
          } catch (error) {
            report(`callback:${operation}`, error);
            throw error;
          } finally {
            state.callbackActive--;
          }
        };
        try {
          return await scope[operation](...args);
        } catch (error) {
          report(operation, error);
          throw error;
        } finally {
          state.active--;
          state.completed++;
          state.duration.add(performance.now() - began);
        }
      }
      return {
        ...scope,
        execute: (...args) => observed("execute", args),
        transaction: (...args) => observed("transaction", args),
        consumeOnce: (...args) => observed("consumeOnce", args),
      };
    },
  };
}

export function createCapacityDeliveryObservation() {
  const service = latencyHistogram(),
    queueAge = latencyHistogram();
  let failed = 0;
  return {
    result: () => ({ service: service.result(), queueAge: queueAge.result(), failed }),
    async publish(publish, input) {
      // Validated trusted intent timestamp only; no identity or payload is retained.
      queueAge.add(Math.max(0, Date.now() - input.occurredAt));
      const began = performance.now();
      try {
        return await publish(input);
      } catch (error) {
        failed++;
        throw error;
      } finally {
        service.add(performance.now() - began);
      }
    },
  };
}

function queryCategory(text) {
  const kind =
    /^\s*(SELECT|INSERT|UPDATE|DELETE|LOCK|BEGIN|COMMIT|ROLLBACK)\b/i
      .exec(text)?.[1]
      ?.toLowerCase() ?? "other";
  if (["begin", "commit", "rollback"].includes(kind)) return `transaction/${kind}`;
  const primary = /\b(?:FROM|INTO|UPDATE|TABLE)\s+(?:"public"\.)?(?:"([a-z_]+)"|([a-z_]+))/i.exec(
    text,
  );
  const table = (primary?.[1] ?? primary?.[2] ?? "other").toLowerCase();
  const known = [
    "users",
    "sessions",
    "games",
    "rooms",
    "room_members",
    "room_command_receipts",
    "matches",
    "match_players",
    "game_events",
    "processed_commands",
    "outbox_events",
    "match_admissions",
    "match_reservations",
    "match_connection_leases",
    "match_results",
    "game_results",
  ];
  return `${known.includes(table) ? table : "other"}/${kind === "select" && /\bFOR\s+UPDATE\b/i.test(text) ? "lock" : kind}`;
}

export function observeCapacityPgClient(Client, emit, options = {}) {
  // Test-process observation only. Never retain query text/parameters or error messages.
  const original = Client.prototype.query;
  const enabled = options.work === true;
  const work = new Map();
  function start(category, began) {
    if (!work.has(category))
      work.set(category, {
        active: new Set(),
        maximumActive: 0,
        completed: 0,
        totalMs: 0,
        duration: latencyHistogram(),
      });
    const state = work.get(category),
      token = { began };
    let ended = false;
    state.active.add(token);
    state.maximumActive = Math.max(state.maximumActive, state.active.size);
    return () => {
      if (ended) return;
      ended = true;
      const elapsed = performance.now() - began;
      state.active.delete(token);
      state.completed++;
      state.totalMs += elapsed;
      state.duration.add(elapsed);
    };
  }
  function query(...args) {
    let text = "";
    try {
      const candidate = typeof args[0] === "string" ? args[0] : args[0]?.text;
      if (typeof candidate === "string") text = candidate;
    } catch {
      /* Observation cannot change a hostile query object's result. */
    }
    const commit = text === "COMMIT";
    const operation = commit ? "query:commit" : "query:statement";
    function report(error) {
      let code = "OTHER";
      try {
        const candidate = `PG_${error?.code}`;
        if (codes.includes(candidate)) code = candidate;
      } catch {
        /* Fixed fallback only. */
      }
      try {
        emit({ type: "capacity-failure", owner: "database", operation, code });
      } catch {
        /* Observation cannot alter the driver's failure. */
      }
    }
    function failed(error) {
      report(error);
      throw error;
    }
    let finish;
    try {
      const began = enabled ? performance.now() : 0;
      const category = enabled ? queryCategory(text) : null;
      const callback = typeof args.at(-1) === "function" ? args.at(-1) : null;
      if (enabled && callback) {
        finish = start(category, began);
        args[args.length - 1] = function (...reply) {
          finish();
          if (reply[0]) report(reply[0]);
          return callback.apply(this, reply);
        };
      }
      const result = original.apply(this, args);
      if (callback) return result;
      if (!result?.then) return result;
      const observed = result.catch(failed);
      if (!enabled) return observed;
      finish = start(category, began);
      return observed.finally(finish);
    } catch (error) {
      finish?.();
      return failed(error);
    }
  }
  Client.prototype.query = query;
  const restore = () => {
    if (Client.prototype.query === query) Client.prototype.query = original;
  };
  return Object.assign(restore, {
    snapshot() {
      const now = performance.now();
      return Object.fromEntries(
        [...work].map(([key, state]) => [
          key,
          {
            active: state.active.size,
            maximumActive: state.maximumActive,
            maximumAgeMs: Math.max(0, ...[...state.active].map(({ began }) => now - began)),
            completed: state.completed,
            totalMs: state.totalMs,
            duration: state.duration.result(),
          },
        ]),
      );
    },
  });
}

export function observeCapacityPgPool(Pool, emit) {
  const original = Pool.prototype.connect;
  function report(error) {
    if (!error) return;
    const code = poolFailureCode(error);
    try {
      emit({ type: "capacity-failure", owner: "database", operation: "pool:connect", code });
    } catch {
      /* Observation cannot alter pool admission. */
    }
  }
  function connect(callback) {
    if (typeof callback === "function")
      return original.call(this, function (error, ...rest) {
        report(error);
        return callback.call(this, error, ...rest);
      });
    return original.call(this).catch((error) => {
      report(error);
      throw error;
    });
  }
  Pool.prototype.connect = connect;
  return () => {
    if (Pool.prototype.connect === connect) Pool.prototype.connect = original;
  };
}

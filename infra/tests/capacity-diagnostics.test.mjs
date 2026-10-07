import { expect, it, vi } from "vitest";
import {
  capacityFailureKey,
  observeCapacityDatabase,
  observeCapacityPgClient,
  createCapacityDeliveryObservation,
  createCapacityWorkTracker,
  capacityCpuSummary,
  observeCapacityPgPool,
  observeCapacityOutcome,
  observeCapacityAdmissionRedis,
  capacityDatabaseActivity,
  capacityDeliveryActivity,
  observeCapacityGame,
  observeCapacityAutomation,
  capacityAutomationObservation,
} from "../scripts/capacity-diagnostics.mjs";

it("distinguishes concentrated and independent active delivery jobs without exporting identities", () => {
  const jobs = Array.from({ length: 32 }, (_, i) => ({
    data: { aggregateId: `PRIVATE_MATCH_${i % 8}`, payload: "PRIVATE_PAYLOAD" },
    processedOn: 1000 + i,
  }));
  expect(capacityDeliveryActivity(jobs, 2000)).toEqual({
    observedActiveJobs: 32,
    activeMatches: 8,
    maximumJobsPerMatch: 4,
    unknownMatchJobs: 0,
    maximumActiveAgeMs: 1000,
  });
  jobs.forEach((job) => (job.data.aggregateId = "PRIVATE_MATCH"));
  const result = capacityDeliveryActivity(jobs, 2000);
  expect(result).toMatchObject({ activeMatches: 1, maximumJobsPerMatch: 32 });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  expect(capacityDeliveryActivity([{ data: {}, processedOn: 3000 }], 2000)).toMatchObject({
    unknownMatchJobs: 1,
    maximumActiveAgeMs: 0,
  });
});

it("observes held promise-query work with fixed categories and no SQL, arguments or results", async () => {
  const releases = [];
  const result = { rows: [{ private: "PRIVATE_RESULT" }] };
  class Client {
    query(input) {
      expect(input.values).toEqual(["PRIVATE_PARAMETER"]);
      return new Promise((resolve) => releases.push(() => resolve(result)));
    }
  }
  const original = Client.prototype.query;
  const observer = observeCapacityPgClient(Client, () => {}, { work: true });
  const work = Array.from({ length: 32 }, () =>
    new Client().query({
      text: 'SELECT "id" FROM "public"."matches" WHERE "id" = $1 FOR UPDATE /* PRIVATE_SQL */',
      values: ["PRIVATE_PARAMETER"],
    }),
  );
  try {
    expect(observer.snapshot()["matches/lock"]).toMatchObject({
      active: 32,
      maximumActive: 32,
      completed: 0,
    });
    releases.forEach((release) => release());
    expect((await Promise.all(work)).every((value) => value === result)).toBe(true);
    const snapshot = observer.snapshot();
    expect(snapshot["matches/lock"]).toMatchObject({
      active: 0,
      maximumActive: 32,
      completed: 32,
      duration: { count: 32 },
    });
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_");
  } finally {
    releases.forEach((release) => release());
    await Promise.allSettled(work);
    observer();
  }
  expect(Client.prototype.query).toBe(original);
});

it("keeps query-work observation optional and bounds unknown query names while preserving errors", async () => {
  const error = Object.assign(new Error("PRIVATE_ERROR"), { code: "40001" });
  class Client {
    query() {
      return Promise.reject(error);
    }
  }
  const sent = [];
  let observer = observeCapacityPgClient(Client, (message) => sent.push(message));
  try {
    await expect(new Client().query("COMMIT")).rejects.toBe(error);
    expect(observer.snapshot()).toEqual({});
  } finally {
    observer();
  }
  observer = observeCapacityPgClient(Client, (message) => sent.push(message), { work: true });
  try {
    await expect(new Client().query("SELECT * FROM PRIVATE_TABLE WHERE PRIVATE_SQL")).rejects.toBe(
      error,
    );
    expect(Object.keys(observer.snapshot())).toEqual(["other/select"]);
    expect(observer.snapshot()["other/select"]).toMatchObject({ active: 0, completed: 1 });
    expect(JSON.stringify([sent, observer.snapshot()])).not.toContain("PRIVATE_");
  } finally {
    observer();
  }
});

it("observes callback pool queries without changing callback receiver, arguments or query return", () => {
  const replies = [];
  const handle = { private: "PRIVATE_HANDLE" },
    receiver = { private: "PRIVATE_RECEIVER" };
  const error = Object.assign(new Error("PRIVATE_ERROR"), { code: "08006" });
  class Client {
    query(input, values, callback) {
      expect(values).toEqual(["PRIVATE_PARAMETER"]);
      replies.push(() => callback.call(receiver, error, "PRIVATE_RESULT"));
      return handle;
    }
  }
  const sent = [],
    calls = [];
  const observer = observeCapacityPgClient(Client, (message) => sent.push(message), { work: true });
  try {
    for (let i = 0; i < 32; i++)
      expect(
        new Client().query(
          'SELECT "id" FROM "public"."users" WHERE "id" = $1',
          ["PRIVATE_PARAMETER"],
          function (...args) {
            calls.push({ receiver: this, args });
          },
        ),
      ).toBe(handle);
    expect(observer.snapshot()["users/select"]).toMatchObject({ active: 32, completed: 0 });
    replies.splice(0).forEach((reply) => reply());
    expect(calls).toHaveLength(32);
    expect(
      calls.every(
        (call) =>
          call.receiver === receiver && call.args[0] === error && call.args[1] === "PRIVATE_RESULT",
      ),
    ).toBe(true);
    expect(observer.snapshot()["users/select"]).toMatchObject({ active: 0, completed: 32 });
    expect(
      sent.every((message) => capacityFailureKey(message) === "database/query:statement/PG_08006"),
    ).toBe(true);
    expect(JSON.stringify([sent, observer.snapshot()])).not.toContain("PRIVATE_");
  } finally {
    replies.splice(0).forEach((reply) => reply());
    observer();
  }
});

it("attributes an exact raw pool timeout to its owning callback before database normalization", async () => {
  const raw = new Error("Connection terminated due to connection timeout");
  const normalized = { code: "DATABASE_OPERATION_FAILED", message: "PRIVATE_ERROR" };
  const sent = [];
  const database = {
    forModule: () => ({
      execute: async (run) => {
        try {
          return await run({});
        } catch {
          throw normalized;
        }
      },
    }),
  };
  const observed = observeCapacityDatabase(database, (message) => sent.push(message));
  await expect(
    observed.forModule("users").execute(async () => {
      throw raw;
    }),
  ).rejects.toBe(normalized);
  expect(sent.map(capacityFailureKey)).toEqual([
    "users/callback:execute/PG_POOL_CONNECT_TIMEOUT",
    "users/execute/DATABASE_OPERATION_FAILED",
  ]);
  expect(JSON.stringify(sent)).not.toContain("PRIVATE_");
  expect(JSON.stringify(sent)).not.toContain("Connection terminated");
});

it("observes obsolete automation checkpoints with fixed categories without altering private results", async () => {
  const sent = [],
    input = { expectedStateVersion: 5, private: "PRIVATE_INTENT" };
  for (const [stateVersion, outcome] of [
    [9, "OBSOLETE_STATE"],
    [6, "SINGLE_ADVANCE"],
    [5, "OTHER_CHECKPOINT"],
  ]) {
    const result = { stateVersion, private: "PRIVATE_RESULT" };
    const receiver = {};
    const observed = observeCapacityAutomation(
      function (...args) {
        expect(this).toBe(receiver);
        expect(args).toEqual([input, "PRIVATE_CONTEXT"]);
        return result;
      },
      (message) => sent.push(message),
    );
    expect(await observed.call(receiver, input, "PRIVATE_CONTEXT")).toBe(result);
    expect(sent.at(-1).outcome).toBe(outcome);
    expect(capacityAutomationObservation(sent.at(-1))).toBe(true);
  }
  expect(JSON.stringify(sent)).not.toContain("PRIVATE_");
  const error = new Error("PRIVATE_FAILURE");
  await expect(
    observeCapacityAutomation(
      async () => {
        throw error;
      },
      (message) => sent.push(message),
    )(input),
  ).rejects.toBe(error);
  expect(sent).toHaveLength(3);
  expect(capacityAutomationObservation({ ...sent[0], payload: "PRIVATE_INTENT" })).toBe(false);
  expect(capacityAutomationObservation({ ...sent[0], outcome: "PRIVATE_CATEGORY" })).toBe(false);
  const result = { stateVersion: 9 };
  expect(
    await observeCapacityAutomation(
      async () => result,
      () => {
        throw error;
      },
    )(input),
  ).toBe(result);
});

it("times only fixed synchronous game operations without changing results, receivers or errors", () => {
  const result = { private: "PRIVATE_STATE" },
    error = new Error("PRIVATE_FAILURE");
  const original = {
    descriptor: { private: "PRIVATE_DESCRIPTOR" },
    project(...args) {
      expect(this).toBe(observed.game);
      expect(args).toEqual(["PRIVATE_INPUT"]);
      return result;
    },
    restore() {
      throw error;
    },
  };
  const observed = observeCapacityGame(original);
  expect(observed.game.project("PRIVATE_INPUT")).toBe(result);
  expect(() => observed.game.restore()).toThrow(error);
  expect(observed.result()).toMatchObject({ project: { count: 1 }, restore: { count: 1 } });
  expect(Object.keys(observed.result())).toEqual(["restore", "project"]);
  expect(JSON.stringify(observed.result())).not.toContain("PRIVATE_");
});

it("summarizes database waits with fixed dimensions without retaining identities or query text", () => {
  const result = capacityDatabaseActivity([
    {
      state: "active",
      wait_event_type: "Lock",
      connections: 9,
      blocked: 9,
      maximum_transaction_ms: 2000,
      pid: "PRIVATE_PID",
      query: "PRIVATE_QUERY",
    },
    {
      state: "idle in transaction",
      wait_event_type: "Client",
      connections: 1,
      blocked: 0,
      maximum_transaction_ms: 2100,
    },
    {
      state: "PRIVATE_STATE",
      wait_event_type: "PRIVATE_WAIT",
      connections: 2,
      blocked: 0,
      maximum_transaction_ms: null,
    },
  ]);
  expect(result).toEqual({
    active: 9,
    idle: 0,
    idleInTransaction: 1,
    other: 2,
    waitingOnLock: 9,
    waitingOnClient: 1,
    waitingOnOther: 2,
    blocked: 9,
    maximumTransactionMs: 2100,
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_");
});

it("separates Redis invalid-window replies from command failures without exposing command material", async () => {
  const sent = [];
  const input = ["PRIVATE_SCRIPT", { keys: ["hambazi:transport-rate:v1:PRIVATE_KEY"] }];
  const reply = [-1, 0];
  const error = { name: "AbortError", message: "PRIVATE_ERROR" };
  const prototype = { eval: vi.fn().mockResolvedValue(reply) };
  const original = prototype.eval;
  const restore = observeCapacityAdmissionRedis(prototype, (message) => sent.push(message));
  try {
    expect(await prototype.eval(...input)).toBe(reply);
    expect(original).toHaveBeenCalledWith(...input);
    expect(original.mock.contexts[0]).toBe(prototype);
    original.mockRejectedValueOnce(error);
    await expect(prototype.eval(...input)).rejects.toBe(error);
    expect(sent.map(capacityFailureKey)).toEqual([
      "realtime/redis:admission/REDIS_WINDOW_INVALID",
      "realtime/redis:admission/REDIS_COMMAND_ABORTED",
    ]);
    expect(JSON.stringify(sent)).not.toContain("PRIVATE_");
    sent.length = 0;
    expect(await prototype.eval("PRIVATE_OTHER", { keys: ["PRIVATE_OTHER_KEY"] })).toBe(reply);
    expect(sent).toEqual([]);
  } finally {
    restore();
  }
  expect(prototype.eval).toBe(original);
});

it("observes fixed admission and resync outcomes while preserving arguments, receivers and results", async () => {
  const sent = [];
  const result = { allowed: false, reason: "unavailable", private: "PRIVATE_RESULT" };
  const owner = {
    run: observeCapacityOutcome(
      "realtime",
      "rate:event",
      function (...args) {
        expect(this).toBe(owner);
        expect(args).toEqual(["PRIVATE_USER", "PRIVATE_INPUT"]);
        return result;
      },
      (message) => sent.push(message),
    ),
  };
  expect(await owner.run("PRIVATE_USER", "PRIVATE_INPUT")).toBe(result);
  expect(sent.map(capacityFailureKey)).toEqual(["realtime/rate:event/RATE_UNAVAILABLE"]);
  expect(JSON.stringify(sent)).not.toContain("PRIVATE_");
  const failed = { ok: false, error: { code: "INTERNAL_ERROR", message: "PRIVATE_ERROR" } };
  expect(
    await observeCapacityOutcome(
      "matches",
      "projection:catchup",
      () => failed,
      () => {
        throw new Error("PRIVATE_OBSERVER");
      },
    )(),
  ).toBe(failed);
});

it("separates session and renewal rejection codes without exposing authentication or lease input", async () => {
  const sent = [];
  const result = { ok: false, error: { code: "GAME_STATE_CONFLICT", message: "PRIVATE_FAILURE" } };
  const renew = observeCapacityOutcome(
    "matches",
    "reconnect:renew",
    () => result,
    (message) => sent.push(message),
  );
  expect(await renew("PRIVATE_LEASE")).toBe(result);
  const expired = { ok: false, error: { code: "UNAUTHENTICATED", message: "PRIVATE_TOKEN" } };
  expect(
    await observeCapacityOutcome(
      "auth",
      "session:authenticate",
      () => expired,
      (message) => sent.push(message),
    )("PRIVATE_CREDENTIAL"),
  ).toBe(expired);
  expect(sent.map(capacityFailureKey)).toEqual([
    "matches/reconnect:renew/GAME_STATE_CONFLICT",
    "auth/session:authenticate/UNAUTHENTICATED",
  ]);
  expect(JSON.stringify(sent)).not.toContain("PRIVATE_");
});

it("observes pool exhaustion without exposing messages or altering promise/callback results", async () => {
  const error = new Error("timeout exceeded when trying to connect");
  class Pool {
    connect(callback) {
      if (callback) return callback(error, "PRIVATE_CLIENT_CANARY");
      return Promise.reject(error);
    }
  }
  const original = Pool.prototype.connect;
  const sent = [];
  const restore = observeCapacityPgPool(Pool, (message) => sent.push(message));
  try {
    const pool = new Pool();
    await expect(pool.connect()).rejects.toBe(error);
    let received;
    pool.connect((...args) => {
      received = args;
    });
    expect(received).toEqual([error, "PRIVATE_CLIENT_CANARY"]);
    expect(sent).toHaveLength(2);
    expect(
      sent.every((m) => capacityFailureKey(m) === "database/pool:connect/PG_POOL_ACQUIRE_TIMEOUT"),
    ).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("PRIVATE_");
    expect(JSON.stringify(sent)).not.toContain("timeout exceeded");
  } finally {
    restore();
  }
  expect(Pool.prototype.connect).toBe(original);
});

it("keeps successful owner operations and transaction arguments unchanged", async () => {
  const sent = [];
  const args = [];
  const scope = {
    transaction: async (...input) => {
      args.push(input);
      return input[0]("scoped-client");
    },
  };
  const database = { forModule: () => scope };
  const observed = observeCapacityDatabase(database, (message) => sent.push(message));
  const received = [];
  const operation = (...input) => {
    received.push(input);
    return 7;
  };
  expect(await observed.forModule("rooms").transaction(operation, "Serializable")).toBe(7);
  expect(args[0][1]).toBe("Serializable");
  expect(received).toEqual([["scoped-client"]]);
  expect(sent).toEqual([]);
});

it("records fixed owner work counts while preserving concurrent callbacks and their results", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const database = { forModule: () => ({ transaction: (run) => run("PRIVATE_DATABASE") }) };
  const observed = observeCapacityDatabase(database, () => {});
  const scope = observed.forModule("matches");
  const tasks = Array.from({ length: 32 }, () =>
    scope.transaction(async () => {
      await gate;
      return "PRIVATE_RESULT";
    }),
  );
  expect(observed.capacityWorkSnapshot()["matches/transaction"]).toMatchObject({
    active: 32,
    callbackActive: 32,
    maximumActive: 32,
    maximumCallbackActive: 32,
    completed: 0,
  });
  expect(JSON.stringify(observed.capacityWorkSnapshot())).not.toContain("PRIVATE_");
  release();
  expect(await Promise.all(tasks)).toEqual(Array(32).fill("PRIVATE_RESULT"));
  expect(observed.capacityWorkSnapshot()["matches/transaction"]).toMatchObject({
    active: 0,
    callbackActive: 0,
    completed: 32,
    duration: { count: 32 },
  });
});

it("exports only fixed CPU buckets and numeric counts, never profiler frames or private fields", () => {
  const input = {
    nodes: [
      {
        callFrame: {
          url: "file:///node_modules/@prisma/client/PRIVATE_URL",
          functionName: "PRIVATE_NAME",
        },
        hitCount: 5,
        payload: "PRIVATE_STATE",
      },
      {
        callFrame: { url: "file:///PRIVATE_LOCATION", functionName: "PRIVATE_FUNCTION" },
        hitCount: "PRIVATE_COUNT",
      },
      {
        callFrame: { url: "wasm://wasm/PRIVATE_MODULE", functionName: "PRIVATE_FUNCTION" },
        hitCount: 3,
      },
    ],
    startTime: 100,
    endTime: 200,
  };
  expect(capacityCpuSummary(input)).toMatchObject({
    samples: { prisma: 5, wasm: 3, other: 0 },
    durationMicros: 100,
  });
  expect(JSON.stringify(capacityCpuSummary(input))).not.toContain("PRIVATE_");
});

it("attributes CPU samples through fixed owner ancestry without exporting frames", () => {
  const input = {
    nodes: [
      {
        id: 1,
        children: [2],
        callFrame: {
          url: "file:///apps/api/dist/matches/infrastructure/repositories/resync.js?PRIVATE_QUERY",
        },
        hitCount: 1,
      },
      {
        id: 2,
        children: [3],
        callFrame: { url: "file:///node_modules/@prisma/PRIVATE_QUERY" },
        hitCount: 5,
      },
      { id: 3, callFrame: { url: "", functionName: "PRIVATE_GENERATED" }, hitCount: 4 },
    ],
    startTime: 0,
    endTime: 10,
  };
  expect(capacityCpuSummary(input)).toMatchObject({ callers: { matchProjection: 10, other: 0 } });
  expect(JSON.stringify(capacityCpuSummary(input))).not.toContain("PRIVATE_");
});

it("settles late accepted work and its follow-up reads before failure teardown", async () => {
  const tracker = createCapacityWorkTracker();
  let accept, read;
  const accepted = new Promise((resolve) => {
    accept = resolve;
  });
  const followup = new Promise((resolve) => {
    read = resolve;
  });
  const order = [];
  const work = accepted.then(() => {
    order.push("accepted");
    tracker.add(followup.then(() => order.push("receipt")));
  });
  expect(tracker.add(work)).toBe(work);
  tracker.add(Promise.reject(new Error("PRIVATE_OPERATION_CANARY")));
  const settled = tracker.settle().then(() => order.push("report", "close"));
  await Promise.resolve();
  expect(order).toEqual([]);
  accept();
  await work;
  expect(order).toEqual(["accepted"]);
  read();
  await settled;
  expect(order).toEqual(["accepted", "receipt", "report", "close"]);
});

it("measures queue age separately from service time without retaining the intent", async () => {
  const wall = vi.spyOn(Date, "now").mockReturnValue(1500);
  const monotonic = vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(120);
  try {
    const observation = createCapacityDeliveryObservation();
    const input = { occurredAt: 1000, private: "PRIVATE_INTENT_CANARY" };
    const error = new Error("PRIVATE_ERROR_CANARY");
    await expect(
      observation.publish(async (value) => {
        expect(value).toBe(input);
        throw error;
      }, input),
    ).rejects.toBe(error);
    expect(observation.result()).toMatchObject({
      queueAge: { count: 1, maximumMs: 500 },
      service: { count: 1, maximumMs: 20 },
      failed: 1,
    });
    expect(JSON.stringify(observation.result())).not.toContain("PRIVATE_");
  } finally {
    wall.mockRestore();
    monotonic.mockRestore();
  }
});

it("separates application and raw callback failures from sanitized database failures", async () => {
  for (const code of ["GAME_STATE_CONFLICT", "P2028", "PRIVATE_CODE_CANARY"]) {
    const original = { code, message: "PRIVATE_ERROR_CANARY" };
    const sanitized = { code: "DATABASE_OPERATION_FAILED" };
    const sent = [];
    const observed = observeCapacityDatabase(
      {
        forModule: () => ({
          transaction: async (callback) => {
            try {
              await callback({});
            } catch {
              throw sanitized;
            }
          },
        }),
      },
      (message) => sent.push(message),
    );
    await expect(
      observed.forModule("matches").transaction(() => {
        throw original;
      }),
    ).rejects.toBe(sanitized);
    expect(sent.map((m) => capacityFailureKey(m))).toEqual([
      `matches/callback:transaction/${code === "P2028" ? "PRISMA_P2028" : code === "GAME_STATE_CONFLICT" ? code : "OTHER"}`,
      "matches/transaction/DATABASE_OPERATION_FAILED",
    ]);
    expect(JSON.stringify(sent)).not.toContain("PRIVATE_");
  }
});

it("records only fixed failure dimensions and preserves the original failure", async () => {
  const error = { code: "DATABASE_TRANSACTION_CONFLICT", message: "PRIVATE_SQL_CANARY" };
  const scope = {
    transaction: async () => {
      throw error;
    },
  };
  const sent = [];
  const observed = observeCapacityDatabase({ forModule: () => scope }, (message) =>
    sent.push(message),
  );
  await expect(observed.forModule("rooms").transaction(() => {})).rejects.toBe(error);
  expect(sent).toEqual([
    {
      type: "capacity-failure",
      owner: "rooms",
      operation: "transaction",
      code: "DATABASE_TRANSACTION_CONFLICT",
    },
  ]);
  expect(JSON.stringify(sent)).not.toContain("PRIVATE_SQL_CANARY");
  expect(capacityFailureKey(sent[0])).toBe("rooms/transaction/DATABASE_TRANSACTION_CONFLICT");
});

it("suppresses private and hostile error codes without altering failure semantics", async () => {
  for (const error of [
    { code: "PRIVATE_CODE_CANARY" },
    {
      get code() {
        throw new Error("PRIVATE_GETTER_CANARY");
      },
    },
  ]) {
    const sent = [];
    const observed = observeCapacityDatabase(
      {
        forModule: () => ({
          execute: async () => {
            throw error;
          },
        }),
      },
      (message) => sent.push(message),
    );
    await expect(observed.forModule("rooms").execute(() => {})).rejects.toBe(error);
    expect(sent).toEqual([
      { type: "capacity-failure", owner: "rooms", operation: "execute", code: "OTHER" },
    ]);
  }
});

it("cannot replace the original database failure if the diagnostic receiver fails", async () => {
  const error = new Error("PRIVATE_ORIGINAL_CANARY");
  const observed = observeCapacityDatabase(
    {
      forModule: () => ({
        execute: async () => {
          throw error;
        },
      }),
    },
    () => {
      throw new Error("PRIVATE_OBSERVER_CANARY");
    },
  );
  await expect(observed.forModule("users").execute(() => {})).rejects.toBe(error);
});

it("rejects unknown dimensions and extra fields at the report boundary", () => {
  const valid = {
    type: "capacity-failure",
    owner: "rooms",
    operation: "rate:invite",
    code: "RATE_UNAVAILABLE",
  };
  expect(capacityFailureKey(valid)).toBe("rooms/rate:invite/RATE_UNAVAILABLE");
  for (const input of [
    null,
    {},
    { ...valid, owner: "PRIVATE_OWNER_CANARY" },
    { ...valid, code: "PRIVATE_CODE_CANARY" },
    { ...valid, operation: "PRIVATE_OPERATION_CANARY" },
    { ...valid, payload: "PRIVATE_PAYLOAD_CANARY" },
    {
      get type() {
        throw new Error("PRIVATE_GETTER_CANARY");
      },
    },
  ])
    expect(capacityFailureKey(input)).toBeNull();
});
it("records only allowlisted PostgreSQL codes and restores the untouched driver", async () => {
  const error = { code: "40001", message: "PRIVATE_PG_CANARY", detail: "PRIVATE_PARAMS_CANARY" };
  class Client {
    query() {
      return Promise.reject(error);
    }
  }
  const original = Client.prototype.query;
  const messages = [];
  const restore = observeCapacityPgClient(Client, (message) => messages.push(message));
  try {
    await expect(new Client().query("COMMIT")).rejects.toBe(error);
    expect(messages).toEqual([
      { type: "capacity-failure", owner: "database", operation: "query:commit", code: "PG_40001" },
    ]);
    expect(JSON.stringify(messages)).not.toContain("PRIVATE_");
    expect(capacityFailureKey(messages[0])).toBe("database/query:commit/PG_40001");
  } finally {
    restore();
  }
  expect(Client.prototype.query).toBe(original);
});

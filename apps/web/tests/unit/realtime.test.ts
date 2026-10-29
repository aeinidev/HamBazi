import { expect, it, vi } from "vitest";
import { z } from "zod";
import type { io } from "socket.io-client";
import { createRealtime } from "../../src/platform/realtime.js";
const id = "11111111-1111-4111-8111-111111111111";
const snapshot = (version = 2, role = "PLAYER") => ({
  schemaVersion: 1,
  matchId: id,
  stateVersion: version,
  lastEventSeq: version,
  status: "ACTIVE",
  role,
  gameId: "test",
  engineVersion: "test-v1",
  stateSchemaVersion: 1,
  rulesetVersion: "test-v1",
  view: null,
});
function fixture(personal = false) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const emitted = vi.fn(async (event: string) =>
    event === "match:subscribe"
      ? { ok: true, value: { schemaVersion: 1, matchId: id, role: "PLAYER" } }
      : {
          ok: true,
          value: { schemaVersion: 1, mode: "SNAPSHOT", events: [], snapshot: snapshot() },
        },
  );
  const socket = {
    connected: false,
    auth: {} as unknown,
    on(name: string, cb: (...args: unknown[]) => void) {
      handlers.set(name, cb);
    },
    timeout() {
      return { emitWithAck: emitted };
    },
    connect() {
      this.connected = true;
      handlers.get("connect")?.();
    },
    disconnect() {
      this.connected = false;
      handlers.get("disconnect")?.("io client disconnect");
    },
    removeAllListeners() {
      handlers.clear();
    },
  };
  const callbacks = {
    state: vi.fn(),
    snapshot: vi.fn(),
    expired: vi.fn(),
    error: vi.fn(),
    resync: vi.fn(),
  };
  const connect = vi.fn(() => socket) as unknown as typeof io;
  const realtime = createRealtime("https://api.example", "synthetic", callbacks, connect, personal);
  return { socket, handlers, emitted, callbacks, realtime };
}
const catchup = (version: number) => ({
  ok: true as const,
  value: { schemaVersion: 1, mode: "SNAPSHOT", events: [], snapshot: snapshot(version) },
});
it("catches up again when a newer invalidation arrives during an older read, without rendering the uncovered view", async () => {
  const f = fixture();
  await f.realtime.subscribe(id);
  f.emitted.mockClear();
  f.callbacks.snapshot.mockClear();
  let release!: (value: never) => void;
  f.emitted.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  f.emitted.mockResolvedValue(catchup(4));
  const syncing = f.realtime.sync();
  f.handlers.get("match:event")?.({
    schemaVersion: 1,
    matchId: id,
    eventId: id,
    seq: 4,
    stateVersion: 4,
    type: "MATCH_INVALIDATED_V1",
    payload: {},
  });
  release(catchup(3) as never);
  await syncing;
  expect(f.emitted).toHaveBeenCalledTimes(2);
  expect(f.callbacks.snapshot).not.toHaveBeenCalledWith(snapshot(3));
  expect(f.callbacks.snapshot).toHaveBeenLastCalledWith(snapshot(4));
  expect(f.callbacks.resync).toHaveBeenLastCalledWith(false);
  f.realtime.close();
});
it("keeps a foreground refresh waiting for the read requested after an in-flight catchup", async () => {
  const f = fixture();
  await f.realtime.subscribe(id);
  f.emitted.mockClear();
  let release!: (value: never) => void;
  f.emitted.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  f.emitted.mockResolvedValue(catchup(3));
  const first = f.realtime.sync();
  let completed = false;
  const afterCommand = f.realtime.sync().then(() => {
    completed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(completed).toBe(false);
  release(catchup(2) as never);
  await Promise.all([first, afterCommand]);
  expect(f.emitted).toHaveBeenCalledTimes(2);
  expect(f.callbacks.snapshot).toHaveBeenLastCalledWith(snapshot(3));
  f.realtime.close();
});
it("does not let an old connection's completion clear or report errors into its replacement catchup", async () => {
  const f = fixture();
  await f.realtime.subscribe(id);
  f.emitted.mockClear();
  const releases: ((value: never) => void)[] = [];
  f.emitted.mockImplementation((event) =>
    event === "match:subscribe"
      ? Promise.resolve({ ok: true, value: { schemaVersion: 1, matchId: id, role: "PLAYER" } })
      : new Promise((resolve) => {
          releases.push(resolve);
        }),
  );
  const old = f.realtime.sync();
  f.socket.disconnect();
  f.socket.connect();
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  f.callbacks.snapshot.mockClear();
  f.callbacks.error.mockClear();
  releases[0]!(catchup(3) as never);
  await old;
  expect(f.callbacks.error).not.toHaveBeenCalled();
  const refresh = f.realtime.sync();
  expect(f.emitted).toHaveBeenCalledTimes(3);
  f.emitted.mockResolvedValue(catchup(5));
  releases[1]!(catchup(4) as never);
  await refresh;
  expect(f.callbacks.snapshot).not.toHaveBeenCalledWith(snapshot(3));
  expect(f.callbacks.snapshot).toHaveBeenLastCalledWith(snapshot(5));
  expect(f.callbacks.resync).toHaveBeenLastCalledWith(false);
  f.realtime.close();
});
it("serializes personal commands with polling under the gateway's single pending request guard", async () => {
  const f = fixture(true);
  await f.realtime.subscribe(id);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending = 0;
  let maximum = 0;
  let rejected = 0;
  f.emitted.mockImplementation(async (event) => {
    maximum = Math.max(maximum, ++pending);
    if (pending > 1) {
      pending--;
      rejected++;
      return { ok: false, error: { code: "RATE_LIMITED", retryable: true } } as never;
    }
    if (event === "match:catchup") await held;
    pending--;
    return {
      ok: true,
      value: { schemaVersion: 1, mode: "SNAPSHOT", events: [], snapshot: snapshot() },
    };
  });
  const polling = f.realtime.sync();
  await vi.waitFor(() => expect(pending).toBe(1));
  const command = f.realtime.request(
    "game:command",
    { actionId: id, expectedVersion: 2 },
    z.unknown(),
  );
  const outcome = command.then(
    () => "accepted",
    (error: unknown) => (error as { code: string }).code,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await polling;
  expect(await outcome).toBe("accepted");
  expect(maximum).toBe(1);
  expect(rejected).toBe(0);
  f.realtime.close();
});
it("drops personal intents queued on a previous connection without replaying them", async () => {
  const f = fixture(true);
  let release!: (value: never) => void;
  f.emitted.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const read = f.realtime.request("personal:current", {}, z.unknown());
  await vi.waitFor(() => expect(f.emitted).toHaveBeenCalledTimes(1));
  const command = f.realtime.request("game:command", { actionId: id }, z.unknown());
  const outcomes = Promise.allSettled([read, command]);
  f.socket.disconnect();
  f.socket.connect();
  release({ ok: true } as never);
  for (const result of await outcomes) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected")
      expect(result.reason).toMatchObject({ code: "NETWORK_ERROR" });
  }
  expect(f.emitted).toHaveBeenCalledTimes(1);
  f.realtime.close();
});
it("bounds the personal lane, releases it after errors and never retries real quota rejections", async () => {
  const f = fixture(true);
  let release!: (value: never) => void;
  f.emitted.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const requests = Array.from({ length: 4 }, () =>
    f.realtime.request("personal:current", {}, z.unknown()),
  );
  const outcomes = Promise.allSettled(requests);
  await vi.waitFor(() => expect(f.emitted).toHaveBeenCalledTimes(1));
  await expect(f.realtime.request("game:command", {}, z.unknown())).rejects.toMatchObject({
    code: "RATE_LIMITED",
  });
  release({ ok: false, error: { code: "RATE_LIMITED", retryable: true } } as never);
  expect((await outcomes).filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(f.emitted).toHaveBeenCalledTimes(4);
  await f.realtime.request("personal:current", {}, z.unknown());
  expect(f.emitted).toHaveBeenCalledTimes(5);
  f.realtime.close();
});
it("leaves the ordinary namespace concurrent request policy unchanged", async () => {
  const f = fixture();
  let release!: (value: never) => void;
  f.emitted.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const read = f.realtime.request("match:catchup", {}, z.unknown());
  await f.realtime.request("game:command", {}, z.unknown());
  expect(f.emitted).toHaveBeenCalledTimes(2);
  release({ ok: true } as never);
  await read;
  f.realtime.close();
});
it("acknowledges snapshots, ignores stale/duplicate snapshots and applies spectator downgrade", async () => {
  const f = fixture();
  await f.realtime.subscribe(id);
  f.callbacks.snapshot.mockClear();
  const ack = vi.fn();
  f.handlers.get("match:snapshot")?.(snapshot(3, "SPECTATOR"), ack);
  expect(ack).toHaveBeenCalledWith(3);
  expect(f.callbacks.snapshot).toHaveBeenCalledWith(snapshot(3, "SPECTATOR"));
  f.callbacks.snapshot.mockClear();
  f.handlers.get("match:snapshot")?.(snapshot(2), ack);
  f.handlers.get("match:snapshot")?.(snapshot(3, "SPECTATOR"), ack);
  expect(f.callbacks.snapshot).not.toHaveBeenCalled();
  f.handlers.get("match:snapshot")?.({ ...snapshot(4), matchId: "foreign" }, ack);
  expect(ack).not.toHaveBeenCalledWith(4);
  f.realtime.close();
});
it("gap events request bounded catchup and duplicates do not request again", async () => {
  const f = fixture();
  await f.realtime.subscribe(id);
  f.emitted.mockClear();
  let release!: (value: never) => void;
  f.emitted.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const event = {
    schemaVersion: 1,
    matchId: id,
    eventId: id,
    seq: 3,
    stateVersion: 3,
    type: "MATCH_INVALIDATED_V1",
    payload: {},
  };
  f.handlers.get("match:event")?.(event);
  await vi.waitFor(() => expect(f.emitted).toHaveBeenCalledTimes(1));
  expect(f.callbacks.snapshot).toHaveBeenLastCalledWith(null);
  expect(f.callbacks.resync).toHaveBeenCalledWith(true);
  f.handlers.get("match:event")?.(event);
  expect(f.emitted).toHaveBeenCalledTimes(1);
  release(catchup(3) as never);
  await vi.waitFor(() => expect(f.callbacks.snapshot).toHaveBeenLastCalledWith(snapshot(3)));
  expect(f.callbacks.resync).toHaveBeenLastCalledWith(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  f.emitted.mockResolvedValue(catchup(9));
  f.handlers.get("match:event")?.({ ...event, seq: 9 });
  await vi.waitFor(() => expect(f.emitted).toHaveBeenCalledTimes(2));
  f.realtime.close();
});
it("bounds stale catchup retries, keeps actions unavailable and permits an explicit connected retry", async () => {
  const f = fixture();
  await f.realtime.subscribe(id);
  f.emitted.mockClear();
  f.handlers.get("match:event")?.({
    schemaVersion: 1,
    matchId: id,
    eventId: id,
    seq: 4,
    stateVersion: 4,
    type: "MATCH_INVALIDATED_V1",
    payload: {},
  });
  await vi.waitFor(() =>
    expect(f.callbacks.error).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "INVALID_RESPONSE", retryable: true }),
    ),
  );
  expect(f.emitted).toHaveBeenCalledTimes(2);
  expect(f.callbacks.snapshot).toHaveBeenLastCalledWith(null);
  expect(f.callbacks.resync).toHaveBeenLastCalledWith(true);
  f.emitted.mockResolvedValue(catchup(4));
  f.realtime.retry();
  await vi.waitFor(() => expect(f.callbacks.snapshot).toHaveBeenLastCalledWith(snapshot(4)));
  expect(f.emitted).toHaveBeenCalledTimes(3);
  expect(f.callbacks.resync).toHaveBeenLastCalledWith(false);
  f.realtime.close();
});
it("never buffers disconnected commands, rejects late acknowledgements and drops auth on close", async () => {
  const f = fixture();
  f.socket.disconnect();
  await expect(f.realtime.request("room:start", {}, z.object({}))).rejects.toMatchObject({
    code: "NETWORK_ERROR",
    retryable: true,
  });
  expect(f.emitted).not.toHaveBeenCalled();
  f.socket.connect();
  let resolve!: (value: never) => void;
  f.emitted.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const result = f.realtime.request("room:start", {}, z.object({}));
  f.realtime.close();
  resolve({ ok: true } as never);
  await expect(result).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  expect(f.socket.auth).toEqual({});
  expect(f.callbacks.snapshot).toHaveBeenLastCalledWith(null);
});
it("uses stable authentication codes rather than reflecting transport errors", () => {
  const f = fixture();
  f.handlers.get("connect_error")?.({ data: { code: "UNAUTHENTICATED" }, message: "secret" });
  expect(f.callbacks.expired).toHaveBeenCalledOnce();
  f.realtime.close();
});

it("validates and acknowledges Chat delivery locally, rejects foreign content and disposes listeners", async () => {
  const f = fixture();
  await f.realtime.subscribe(id);
  const listener = vi.fn();
  const stop = f.realtime.onChat(listener);
  const message = {
    schemaVersion: 1,
    matchId: id,
    messageId: id,
    userId: id,
    seq: 1,
    text: "<b>text</b>",
    createdAt: 1000,
  };
  const ack = vi.fn();
  f.handlers.get("chat:message")?.(message, ack);
  expect(listener).toHaveBeenCalledWith(message);
  expect(ack).toHaveBeenCalledWith(id);
  f.handlers.get("chat:message")?.({ ...message, matchId: "foreign" }, ack);
  expect(listener).toHaveBeenCalledTimes(1);
  stop();
  f.handlers.get("chat:message")?.(message, ack);
  expect(listener).toHaveBeenCalledTimes(1);
  f.realtime.close();
});

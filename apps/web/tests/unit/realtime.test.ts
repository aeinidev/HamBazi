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
function fixture() {
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
  const realtime = createRealtime("https://api.example", "synthetic", callbacks, connect);
  return { socket, handlers, emitted, callbacks, realtime };
}
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  f.handlers.get("match:event")?.({ ...event, seq: 9 });
  await vi.waitFor(() => expect(f.emitted).toHaveBeenCalledTimes(2));
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

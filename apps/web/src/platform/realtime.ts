import { chatMessageSchema, type ChatMessage } from "../features/chat/index.js";
import { io, type Socket } from "socket.io-client";
import { createMatchSequence } from "@hambazi/contracts";
import type { z } from "zod";
import { ClientError, failure } from "./errors.js";
import {
  catchupSchema,
  eventSchema,
  memberSchema,
  okValue,
  snapshotSchema,
  type Snapshot,
} from "./contracts.js";
export type Connection = "offline" | "connecting" | "connected" | "reconnecting";
export function createRealtime(
  origin: string,
  accessToken: string,
  callbacks: {
    state(value: Connection): void;
    snapshot(value: Snapshot | null): void;
    expired(): void;
    error(value: ClientError | null): void;
    resync(value: boolean): void;
  },
  connect: typeof io = io,
  personal = false,
  transport?: { namespace: "kahroba-v1"; path: "/v1/kahroba/socket.io" },
) {
  const chatListeners = new Set<(message: ChatMessage) => void>();
  let disposed = false;
  let matchId: string | null = null;
  let sequence: ReturnType<typeof createMatchSequence> | undefined;
  let syncing: Promise<void> | undefined;
  let syncRequested = false;
  let generation = 0;
  // The personal gateway permits one pending request per socket. Keep polling,
  // reconnect lookups and foreground intents in the same bounded lane.
  let personalTail = Promise.resolve();
  let personalPending = 0;
  const socket: Socket = connect(
    `${origin}/${transport?.namespace ?? (personal ? "personal-v1" : "v1")}`,
    {
      path: transport?.path ?? (personal ? "/v1/personal/socket.io" : "/v1/socket.io"),
      // Both admitted gateways expose WebSocket upgrades only at the ingress.
      ...(personal || transport ? { transports: ["websocket"] } : {}),
      auth: { schemaVersion: 1, accessToken },
      autoConnect: false,
      reconnection: true,
      timeout: 10000,
    },
  );
  async function request<T>(event: string, payload: unknown, schema: z.ZodType<T>): Promise<T> {
    if (disposed || !socket.connected) throw new ClientError("NETWORK_ERROR", true);
    const epoch = generation;
    async function send() {
      // A queued intent belongs to its original connection. Never flush it on
      // reconnect; a caller retry must retain its existing command/action ID.
      if (disposed || !socket.connected || epoch !== generation)
        throw new ClientError("NETWORK_ERROR", true);
      let value: unknown;
      try {
        value = await socket.timeout(10000).emitWithAck(event, payload);
      } catch {
        throw new ClientError("NETWORK_ERROR", true);
      }
      if (disposed || epoch !== generation) throw new ClientError("NETWORK_ERROR", true);
      const error = failure(value);
      if (error) {
        if (error.code === "UNAUTHENTICATED") callbacks.expired();
        throw error;
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) throw new ClientError("INVALID_RESPONSE");
      return parsed.data;
    }
    if (!personal) return send();
    if (personalPending >= 4) throw new ClientError("RATE_LIMITED", true);
    personalPending++;
    const preceding = personalTail;
    let release!: () => void;
    personalTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await preceding;
      return await send();
    } finally {
      personalPending--;
      release();
    }
  }
  function apply(value: unknown) {
    const result = snapshotSchema.safeParse(value);
    if (!result.success || result.data.matchId !== matchId || !sequence) return false;
    const action = sequence.snapshot(result.data);
    if (action === "INVALID") return false;
    if (action === "APPLY" && !sequence.cursor().needsResync) {
      callbacks.snapshot(result.data);
      callbacks.resync(false);
    }
    callbacks.error(null);
    return result.data.lastEventSeq;
  }
  function sync(): Promise<void> {
    if (!matchId || disposed || !socket.connected) return Promise.resolve();
    syncRequested = true;
    if (syncing) return syncing;
    const epoch = generation;
    const pending = (async () => {
      try {
        // Coalesce signals during a read, but never poll an uncooperative server indefinitely.
        for (let attempt = 0; attempt < 2; attempt++) {
          syncRequested = false;
          const result = await request(
            "match:catchup",
            { schemaVersion: 1, matchId, afterSeq: sequence?.cursor().lastEventSeq ?? 0 },
            okValue(catchupSchema),
          );
          if (epoch !== generation || disposed) return;
          if (apply(result.value.snapshot) === false) throw new ClientError("INVALID_RESPONSE");
          if (!syncRequested && !sequence?.cursor().needsResync) return;
        }
        callbacks.snapshot(null);
        callbacks.resync(true);
        throw new ClientError("INVALID_RESPONSE", true);
      } catch (error) {
        if (!disposed && epoch === generation)
          callbacks.error(
            error instanceof ClientError ? error : new ClientError("NETWORK_ERROR", true),
          );
      }
    })().finally(() => {
      if (syncing === pending) syncing = undefined;
    });
    syncing = pending;
    return pending;
  }
  async function subscribe(id: string) {
    if (matchId && matchId !== id) {
      socket.disconnect();
      matchId = id;
      sequence = createMatchSequence(id);
      callbacks.snapshot(null);
      callbacks.resync(true);
      socket.connect();
      return;
    }
    if (matchId !== id) {
      matchId = id;
      sequence = createMatchSequence(id);
      callbacks.snapshot(null);
      callbacks.resync(true);
    }
    await request("match:subscribe", { schemaVersion: 1, matchId: id }, okValue(memberSchema));
    // Older gateways may not push an initial snapshot on subscription.
    await sync();
  }
  socket.on("chat:message", (input: unknown, ack: unknown) => {
    const parsed = chatMessageSchema.safeParse(input);
    if (!parsed.success || parsed.data.matchId !== matchId || disposed) return;
    for (const listener of chatListeners) listener(parsed.data);
    if (typeof ack === "function") ack(parsed.data.messageId);
  });
  socket.on("match:snapshot", (value: unknown, ack: unknown) => {
    const seq = apply(value);
    if (seq !== false && typeof ack === "function") ack(seq);
    else callbacks.error(new ClientError("INVALID_RESPONSE"));
  });
  socket.on("match:event", (value: unknown) => {
    const parsed = eventSchema.safeParse(value);
    if (!parsed.success || parsed.data.matchId !== matchId) return;
    const action = sequence?.event(parsed.data);
    if (action === "GAP" || action === "ACCEPT") {
      callbacks.snapshot(null);
      callbacks.resync(true);
      void sync();
    }
  });
  socket.on("connect", () => {
    callbacks.state("connected");
    callbacks.error(null);
    if (matchId)
      void subscribe(matchId).catch((error: unknown) =>
        callbacks.error(error instanceof ClientError ? error : new ClientError("INTERNAL_ERROR")),
      );
  });
  socket.on("disconnect", (reason: string) => {
    generation++;
    syncing = undefined;
    syncRequested = false;
    sequence = matchId ? createMatchSequence(matchId) : undefined;
    callbacks.snapshot(null);
    callbacks.resync(true);
    callbacks.state("reconnecting");
    if (reason === "io server disconnect") callbacks.expired();
  });
  socket.on("connect_error", (error: Error & { data?: { code?: string } }) => {
    callbacks.state("offline");
    if (error.data?.code === "UNAUTHENTICATED") callbacks.expired();
    else callbacks.error(new ClientError(error.data?.code ?? "NETWORK_ERROR", true));
  });
  callbacks.state("connecting");
  socket.connect();
  return {
    onChat(listener: (message: ChatMessage) => void) {
      chatListeners.add(listener);
      return () => {
        chatListeners.delete(listener);
      };
    },
    request,
    subscribe,
    sync,
    retry: () => {
      if (socket.connected) void sync();
      else socket.connect();
    },
    close() {
      disposed = true;
      chatListeners.clear();
      generation++;
      socket.removeAllListeners();
      socket.disconnect();
      socket.auth = {};
      callbacks.snapshot(null);
      callbacks.resync(false);
      callbacks.state("offline");
    },
  };
}
export type Realtime = ReturnType<typeof createRealtime>;

import { createClient } from "redis";
import { createShardedAdapter } from "@socket.io/redis-adapter";
export interface RealtimeRedisAdapter {
  adapter: ReturnType<typeof createShardedAdapter>;
  ready(): boolean;
  onUnavailable(observer: () => void): () => void;
  close(): Promise<void>;
}
/** Owned by composition; Redis transports only state-free wakeups. */
export async function createRealtimeRedisAdapter(options: {
  redisUrl: { reveal(): string };
  namespace: string;
  timeoutMs: number;
}): Promise<RealtimeRedisAdapter> {
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(options.namespace) ||
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 100 ||
    options.timeoutMs > 30000
  )
    throw new Error("Invalid realtime Redis configuration");
  const pub = createClient({
    url: options.redisUrl.reveal(),
    disableOfflineQueue: true,
    socket: { connectTimeout: options.timeoutMs, reconnectStrategy: false },
  });
  const sub = pub.duplicate();
  let failed = false;
  let subscribing = 0;
  const observers = new Set<() => void>();
  function fail() {
    failed = true;
    for (const observer of observers) {
      try {
        observer();
      } catch {
        /* best effort */
      }
    }
  }
  // Adapter 8 fire-and-forgets these promises. Contain rejections and latch unhealthy.
  function guarded(client: typeof pub) {
    return new Proxy(client, {
      get(target, key) {
        const member: unknown = Reflect.get(target, key);
        if (typeof member !== "function") return member;
        if (!["sPublish", "sSubscribe", "sUnsubscribe", "sendCommand"].includes(String(key)))
          return member.bind(target);
        return (...args: unknown[]) => {
          const subscription = key === "sSubscribe";
          if (subscription) subscribing++;
          return Promise.resolve()
            .then(() => Reflect.apply(member, target, args) as unknown)
            .catch(() => {
              fail();
              return key === "sendCommand" ? ["", 0] : 0;
            })
            .finally(() => {
              if (subscription) subscribing--;
            });
        };
      },
    });
  }
  // Fail closed for this process lifetime. A restart rebuilds subscriptions; no silent partial recovery.
  for (const client of [pub, sub])
    client.on("error", () => {
      fail();
    });
  try {
    await Promise.all([pub.connect(), sub.connect()]);
  } catch {
    for (const client of [pub, sub]) if (client.isOpen) client.destroy();
    throw new Error("Realtime Redis unavailable");
  }
  return Object.freeze({
    adapter: createShardedAdapter(guarded(pub), guarded(sub), {
      channelPrefix: `hambazi:realtime:${options.namespace}`,
      subscriptionMode: "static",
    }),
    onUnavailable(observer: () => void) {
      observers.add(observer);
      if (failed) observer();
      return () => {
        observers.delete(observer);
      };
    },
    ready: () => !failed && subscribing === 0 && pub.isReady && sub.isReady,
    close: async () => {
      fail();
      for (const client of [pub, sub]) if (client.isOpen) client.destroy();
    },
  });
}

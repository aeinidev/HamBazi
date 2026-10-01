import type { ChatRate } from "../application/service.js";
import { createHash } from "node:crypto";
import { createClient } from "redis";
export type ChatRateDecision =
  | { allowed: true }
  | { allowed: false; reason: "unavailable" }
  | { allowed: false; reason: "limited"; retryAfterSeconds: number };

const script = `
local value = redis.call('GET', KEYS[1])
if not value then
  redis.call('SET', KEYS[1], '1', 'PX', 60000)
  return {1, 60000}
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then return {-1, 0} end
if tonumber(value) >= tonumber(ARGV[1]) then return {0, ttl} end
redis.call('INCR', KEYS[1])
return {1, ttl}
`;
export function createChatRate(options: {
  url: { reveal(): string };
  namespace: string;
  sendLimit: number;
  readLimit: number;
}) {
  if (
    !Number.isInteger(options.sendLimit) ||
    options.sendLimit < 1 ||
    options.sendLimit > 10 ||
    !Number.isInteger(options.readLimit) ||
    options.readLimit < 1 ||
    options.readLimit > 60 ||
    !/^[\x21-\x7E]{1,256}$/.test(options.namespace)
  )
    throw new Error("Invalid chat rate configuration");
  const client = createClient({
    url: options.url.reveal(),
    disableOfflineQueue: true,
    commandsQueueMaxLength: 256,
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: (attempt) => Math.min(100 * 2 ** Math.min(attempt, 5), 2000),
    },
  });
  client.on("error", () => {});
  const namespace = createHash("sha256").update(options.namespace).digest("hex");
  const consume: ChatRate = async (userId, operation) => {
    if (!client.isReady || !/^[0-9a-f-]{36}$/i.test(userId))
      return { allowed: false, reason: "unavailable" };
    const key = `hambazi:chat-rate:v1:${namespace}:${operation}:${createHash("sha256").update(userId.toLowerCase()).digest("hex")}`;
    try {
      const result = await client.withAbortSignal(AbortSignal.timeout(1000)).eval(script, {
        keys: [key],
        arguments: [String(operation === "send" ? options.sendLimit : options.readLimit)],
      });
      if (!Array.isArray(result) || result.length !== 2) throw new Error();
      const [allowed, ttl] = result;
      if (allowed === 1) return { allowed: true };
      if (allowed !== 0 || typeof ttl !== "number" || ttl < 0 || ttl > 60000) throw new Error();
      return {
        allowed: false,
        reason: "limited",
        retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)),
      };
    } catch {
      return { allowed: false, reason: "unavailable" };
    }
  };
  return {
    consume,
    async connect() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.connect(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error()), 3000);
          }),
        ]);
      } catch {
        throw new Error("Chat rate connection failed");
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      if (client.isOpen) client.destroy();
    },
  };
}

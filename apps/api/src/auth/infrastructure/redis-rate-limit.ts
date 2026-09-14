import { createHash } from "node:crypto";
import { createClient } from "redis";
import type { AuthRateLimiter, RateDecision } from "../application/rate-limit.js";

// One atomic bounded counter and TTL; rejected attempts cannot extend the window.
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
export function createRedisAuthRateLimiter(options: {
  url: { reveal(): string };
  namespace: string;
  ipLimit: number;
  identityLimit: number;
}) {
  if (
    !Number.isInteger(options.ipLimit) ||
    options.ipLimit < 1 ||
    options.ipLimit > 300 ||
    !Number.isInteger(options.identityLimit) ||
    options.identityLimit < 1 ||
    options.identityLimit > 30 ||
    !/^[\x21-\x7E]{1,256}$/.test(options.namespace)
  )
    throw new Error("Invalid auth rate configuration");
  const client = createClient({
    url: options.url.reveal(),
    disableOfflineQueue: true,
    commandsQueueMaxLength: 256,
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: (attempt) => Math.min(100 * 2 ** Math.min(attempt, 5), 2000),
    },
  });
  // Redis error objects can include connection details. Never forward them to telemetry.
  client.on("error", () => {});
  const namespace = createHash("sha256").update(options.namespace).digest("hex");
  async function consume(
    kind: "ip" | "identity",
    subject: string,
    limit: number,
  ): Promise<RateDecision> {
    if (!client.isReady || subject.length === 0 || subject.length > 128)
      return { allowed: false, reason: "unavailable" };
    // This is an ephemeral subject counter, never a hash of initData/token/signature.
    const key = `hambazi:auth-rate:v1:${namespace}:${kind}:${createHash("sha256").update(subject).digest("hex")}`;
    try {
      const result = await client
        .withAbortSignal(AbortSignal.timeout(1000))
        .eval(script, { keys: [key], arguments: [String(limit)] });
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
  }
  const limiter: AuthRateLimiter = Object.freeze({
    consumeIp: (ip: string) => consume("ip", ip, options.ipLimit),
    consumeIdentity: (id: string) => consume("identity", id, options.identityLimit),
  });
  return Object.freeze({
    limiter,
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
        throw new Error("Auth rate connection failed");
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      if (client.isOpen) client.destroy();
    },
  });
}

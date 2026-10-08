import { createHash } from "node:crypto";
import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import { createClient } from "redis";
import { transportAdmissionPolicySchema, type TransportAdmissionPolicy } from "@hambazi/config";
import { withDeadline } from "@hambazi/observability";
import type { RealtimeRate } from "./gateway.js";

export type AdmissionDecision =
  | { allowed: true }
  | { allowed: false; reason: "limited"; retryAfterSeconds: number }
  | { allowed: false; reason: "unavailable" };
export type IpAdmission = (ip: string, operation: "http" | "engine") => Promise<AdmissionDecision>;

export function canonicalIp(input: string): string | undefined {
  if (isIP(input) === 4) return input;
  if (isIP(input) !== 6 || input.includes("%")) return undefined;
  const normalized = new URL(`http://[${input}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/.exec(normalized);
  if (!mapped) return normalized;
  const high = parseInt(mapped[1]!, 16),
    low = parseInt(mapped[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** Walk from the socket peer; only explicitly trusted IPs/CIDRs may forward identity. */
export function createPeerResolver(trustedProxies: readonly string[]) {
  const trusted = new BlockList();
  if (trustedProxies.length > 32) throw new Error("Invalid transport proxy configuration");
  for (const entry of trustedProxies) {
    const [raw, prefix] = entry.split("/");
    const ip = raw && canonicalIp(raw);
    if (!ip || entry.split("/").length > 2)
      throw new Error("Invalid transport proxy configuration");
    const family = isIP(ip) === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) trusted.addAddress(ip, family);
    else {
      let bits = Number(prefix);
      if (isIP(raw!) === 6 && family === "ipv4") {
        // Preserve the IPv4 subnet after removing the 96-bit mapped IPv6 prefix.
        if (bits <= 96 || bits > 128) throw new Error("Invalid transport proxy configuration");
        bits -= 96;
      }
      if (!/^\d+$/.test(prefix) || bits < 1 || bits > (family === "ipv4" ? 32 : 128))
        throw new Error("Invalid transport proxy configuration");
      trusted.addSubnet(ip, bits, family);
    }
  }
  const resolve = (request: Pick<IncomingMessage, "socket" | "headers">): string | undefined => {
    let current = canonicalIp(request.socket.remoteAddress ?? "");
    if (!current) return undefined;
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded !== "string") return current;
    const addresses = forwarded.split(",").map((value) => canonicalIp(value.trim()));
    if (addresses.length > 32 || addresses.some((ip) => ip === undefined)) return current;
    for (const ip of addresses.reverse()) {
      if (!trusted.check(current, isIP(current) === 4 ? "ipv4" : "ipv6")) break;
      current = ip!;
    }
    return current;
  };
  return Object.assign(resolve, {
    secure(request: Pick<IncomingMessage, "socket" | "headers">) {
      if ("encrypted" in request.socket && request.socket.encrypted === true) return true;
      const ip = canonicalIp(request.socket.remoteAddress ?? "");
      return (
        !!ip &&
        trusted.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6") &&
        request.headers["x-forwarded-proto"] === "https"
      );
    },
  });
}

// Fixed window anchored by Redis TTL, shared across nodes. Rejection never renews it.
// Zero is a live window's final millisecond; only negative TTLs signal missing expiry/key.
const script = `
local value = redis.call('GET', KEYS[1])
if not value then
  redis.call('SET', KEYS[1], '1', 'PX', 60000)
  return {1, 60000}
end
local ttl = redis.call('PTTL', KEYS[1])
local count = tonumber(value)
if ttl < 0 or ttl > 60000 or not count or count < 1 or count ~= math.floor(count) then
  return {-1, 0}
end
if count >= tonumber(ARGV[1]) then return {0, ttl} end
redis.call('INCR', KEYS[1])
return {1, ttl}
`;
export function createRedisTransportAdmission(options: {
  url: { reveal(): string };
  namespace: string;
  policy: TransportAdmissionPolicy;
}) {
  const policy = transportAdmissionPolicySchema.safeParse(options.policy);
  if (!policy.success || !/^[\x21-\x7E]{1,256}$/.test(options.namespace))
    throw new Error("Invalid transport admission configuration");
  const client = (() => {
    try {
      return createClient({
        url: options.url.reveal(),
        disableOfflineQueue: true,
        // Keep Redis work bounded by the configured admission budgets. A fixed
        // 256-command queue otherwise rejects an explicitly admitted reconnect
        // wave before its rate limits or connection budget can be evaluated.
        commandsQueueMaxLength: Math.max(
          256,
          policy.data.maxHttpInFlight,
          policy.data.maxEngineInFlight,
          policy.data.maxPendingTotal,
        ),
        socket: {
          connectTimeout: 2000,
          reconnectStrategy: (attempt) => Math.min(100 * 2 ** Math.min(attempt, 5), 2000),
        },
      });
    } catch {
      throw new Error("Transport admission client configuration is invalid");
    }
  })();
  client.on("error", () => {});
  const namespace = createHash("sha256").update(options.namespace).digest("hex");
  const limits = {
    http: policy.data.httpRequestsPerMinute,
    engine: policy.data.engineRequestsPerMinute,
    connect: policy.data.socketConnectionsPerMinute,
    event: policy.data.socketEventsPerMinute,
  };
  async function consume(
    operation: keyof typeof limits,
    subject: string,
  ): Promise<AdmissionDecision> {
    if (!client.isReady || subject.length === 0 || subject.length > 128)
      return { allowed: false, reason: "unavailable" };
    const key = `hambazi:transport-rate:v1:${namespace}:${operation}:${createHash("sha256").update(subject).digest("hex")}`;
    try {
      // Redis removes AbortSignal listeners once a command is written. Bound
      // the reply too, so durable reads/logout can follow their outage policy.
      // A late command may consume quota, but never grants timed-out admission.
      const result = await withDeadline(
        client
          .withAbortSignal(AbortSignal.timeout(1000))
          .eval(script, { keys: [key], arguments: [String(limits[operation])] }),
        1000,
      );
      if (!Array.isArray(result) || result.length !== 2) throw new Error();
      const [allowed, ttl] = result;
      if (
        (allowed !== 0 && allowed !== 1) ||
        typeof ttl !== "number" ||
        !Number.isInteger(ttl) ||
        ttl < 0 ||
        ttl > 60000
      )
        throw new Error();
      return allowed === 1
        ? { allowed: true }
        : {
            allowed: false,
            reason: "limited",
            retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)),
          };
    } catch {
      return { allowed: false, reason: "unavailable" };
    }
  }
  const ip: IpAdmission = async (subject, operation) => {
    const normalized = canonicalIp(subject);
    return normalized ? consume(operation, normalized) : { allowed: false, reason: "unavailable" };
  };
  const rate: RealtimeRate = (userId, operation) =>
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(userId)
      ? consume(operation, userId.toLowerCase())
      : Promise.resolve({ allowed: false, reason: "unavailable" });
  return Object.freeze({
    ip,
    rate,
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
        throw new Error("Transport admission connection failed");
      } finally {
        clearTimeout(timer);
      }
    },
    async probe(signal: AbortSignal) {
      if (!client.isReady) return false;
      try {
        return (await client.withAbortSignal(signal).ping()) === "PONG";
      } catch {
        return false;
      }
    },
    close() {
      if (client.isOpen) client.destroy();
    },
  });
}

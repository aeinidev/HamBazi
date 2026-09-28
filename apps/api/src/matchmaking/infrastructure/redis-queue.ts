import { hash, randomUUID } from "node:crypto";
import { createClient } from "redis";
import { z } from "zod";
import {
  partitionSchema,
  type Claim,
  type Partition,
  type Queue,
} from "../application/contracts.js";
const ticket = partitionSchema.extend({
  schemaVersion: z.literal(1),
  ticketId: z.uuid(),
  actorUserId: z.uuid(),
  commandId: z.uuid(),
  status: z.enum(["SEARCHING", "RESERVED", "MATCHED", "CANCELLED", "EXPIRED"]),
  generation: z.number().int().min(0).max(2147483647),
  expiresAt: z.number().int().nonnegative(),
  reservationId: z.uuid().nullable(),
  reservationUntil: z.number().int().nonnegative().nullable(),
  matchId: z.uuid().nullable(),
});
const claimSchema = z.strictObject({
  reservationId: z.uuid(),
  expiresAt: z.number().int().nonnegative(),
  tickets: z.array(ticket).min(2).max(64),
});
// All keys share one partition hash tag. Lua is bounded: at most 128 expired
// entries and 64 participants per operation. PostgreSQL alone grants authority.
const script = `
local op = ARGV[1]
local time = redis.call('TIME')
local now = tonumber(time[1])*1000 + math.floor(tonumber(time[2])/1000)
local lease = tonumber(ARGV[2])
local function extend(deadline)
  local ttl = math.max(1, deadline - now + lease)
  for _, key in ipairs(KEYS) do
    local old = redis.call('PTTL',key)
    if old == -1 or old < ttl then redis.call('PEXPIRE',key,ttl) end
  end
end
local function save(t, score, owner)
  redis.call('HSET',KEYS[1],t.ticketId,cjson.encode({ticket=t,score=score,owner=owner}))
  redis.call('ZADD',KEYS[6],t.expiresAt,t.ticketId)
end
local function put(t)
  local raw = redis.call('HGET',KEYS[1],t.ticketId)
  local old = raw and cjson.decode(raw) or nil
  if old and (old.ticket.generation > t.generation or (old.owner ~= '' and old.ticket.generation == t.generation)) then return end
  if t.expiresAt <= now then return end
  local score = old and old.score or redis.call('INCR',KEYS[5])
  save(t,score,'')
  if t.status == 'SEARCHING' then redis.call('ZADD',KEYS[2],score,t.ticketId)
  else redis.call('ZREM',KEYS[2],t.ticketId) end
  extend(t.expiresAt)
end
local expired = redis.call('ZRANGEBYSCORE',KEYS[6],'-inf',now,'LIMIT',0,128)
for _,id in ipairs(expired) do
  redis.call('HDEL',KEYS[1],id)
  redis.call('ZREM',KEYS[2],id)
  redis.call('ZREM',KEYS[6],id)
end
if op == 'enqueue' or op == 'remove' then
  local t = cjson.decode(ARGV[3])
  if op == 'remove' then
    local raw = redis.call('HGET',KEYS[1],t.ticketId)
    if raw then
      local old = cjson.decode(raw)
      if old.ticket.generation <= t.generation then
        save(t,old.score,old.owner)
        redis.call('ZREM',KEYS[2],t.ticketId)
      end
    end
  else put(t) end
  return ''
elseif op == 'expired' then
  local ids = redis.call('ZRANGEBYSCORE',KEYS[4],'-inf',now,'LIMIT',0,1)
  if #ids == 0 then return '' end
  local raw = redis.call('HGET',KEYS[3],ids[1])
  if not raw then return redis.error_reply('Invalid claim') end
  return raw
elseif op == 'finish' then
  local id = ARGV[3]
  local raw = redis.call('HGET',KEYS[3],id)
  if not raw then return '' end
  local claim = cjson.decode(raw)
  local current = {}
  for _,t in ipairs(cjson.decode(ARGV[4])) do current[t.ticketId] = t end
  for _,t in ipairs(claim.tickets) do
    local row = redis.call('HGET',KEYS[1],t.ticketId)
    if row then
      local r = cjson.decode(row)
      if r.owner == id then
        redis.call('HDEL',KEYS[1],t.ticketId)
        redis.call('ZREM',KEYS[2],t.ticketId)
        redis.call('ZREM',KEYS[6],t.ticketId)
        local latest = current[t.ticketId]
        if latest and r.ticket.generation > latest.generation then latest = r.ticket end
        if latest and latest.expiresAt > now then
          save(latest,r.score,'')
          if latest.status == 'SEARCHING' then redis.call('ZADD',KEYS[2],r.score,t.ticketId) end
          extend(latest.expiresAt)
        end
      end
    end
  end
  redis.call('HDEL',KEYS[3],id)
  redis.call('ZREM',KEYS[4],id)
  return ''
elseif op == 'claim' then
  local capacity = tonumber(ARGV[3])
  local ids = redis.call('ZRANGE',KEYS[2],0,capacity-1)
  if #ids ~= capacity then return '' end
  local rows = {}
  local deadline = now + lease
  for _,id in ipairs(ids) do
    local raw = redis.call('HGET',KEYS[1],id)
    if not raw then return redis.error_reply('Invalid ticket') end
    local r = cjson.decode(raw)
    if r.ticket.expiresAt <= now or r.ticket.status ~= 'SEARCHING' or r.owner ~= '' then return '' end
    rows[#rows+1] = r
    deadline = math.min(deadline,r.ticket.expiresAt)
  end
  local claim = {reservationId=ARGV[4],expiresAt=deadline,tickets={}}
  for _,r in ipairs(rows) do
    redis.call('ZREM',KEYS[2],r.ticket.ticketId)
    save(r.ticket,r.score,claim.reservationId)
    claim.tickets[#claim.tickets+1] = r.ticket
  end
  local encoded = cjson.encode(claim)
  redis.call('HSET',KEYS[3],claim.reservationId,encoded)
  redis.call('ZADD',KEYS[4],deadline,claim.reservationId)
  for _,r in ipairs(rows) do extend(r.ticket.expiresAt) end
  return encoded
end
return redis.error_reply('Invalid operation')
`;
const rateScript = `
local n = redis.call('GET',KEYS[1])
if not n then redis.call('SET',KEYS[1],1,'PX',ARGV[2]); return 1 end
if redis.call('PTTL',KEYS[1]) < 0 then return -1 end
if tonumber(n) >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR',KEYS[1]); return 1
`;
export function createRedisMatchmakingQueue(options: {
  url: { reveal(): string };
  namespace: string;
  reservationMilliseconds: number;
  searchLimit: number;
  readLimit: number;
  cancelLimit: number;
  rateWindowMilliseconds: number;
}) {
  const {
    reservationMilliseconds: lease,
    searchLimit,
    readLimit,
    cancelLimit,
    rateWindowMilliseconds: window,
  } = options;
  if (
    !/^[\x21-\x7E]{1,256}$/.test(options.namespace) ||
    !Number.isSafeInteger(lease) ||
    lease < 1 ||
    lease > 2147483000 ||
    [searchLimit, readLimit, cancelLimit].some((n) => !Number.isInteger(n) || n < 1 || n > 10000) ||
    !Number.isInteger(window) ||
    window < 1 ||
    window > 3600000
  )
    throw new Error("Invalid matchmaking queue configuration");
  const prefix = `hambazi:matchmaking:v1:${hash("sha256", options.namespace)}`;
  const client = createClient({
    url: options.url.reveal(),
    disableOfflineQueue: true,
    commandsQueueMaxLength: 256,
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: (n) => Math.min(100 * 2 ** Math.min(n, 5), 2000),
    },
  });
  client.on("error", () => {});
  async function execute(p: Partition, op: string, args: string[] = []): Promise<string> {
    try {
      if (!client.isReady) throw new Error();
      const parsed = partitionSchema.parse(p);
      const key = `${prefix}:{${parsed.gameId}:${parsed.mode}:${parsed.capacity}}`;
      const result = await client.withAbortSignal(AbortSignal.timeout(1000)).eval(script, {
        keys: ["tickets", "fifo", "claims", "leases", "sequence", "expiry"].map(
          (s) => `${key}:${s}`,
        ),
        arguments: [op, String(lease), ...args],
      });
      if (typeof result !== "string") throw new Error();
      return result;
    } catch {
      throw new Error("Matchmaking queue unavailable");
    }
  }
  function partition(t: Partition): Partition {
    return { gameId: t.gameId, mode: t.mode, capacity: t.capacity };
  }
  function parseClaim(raw: string): Claim | null {
    return raw ? claimSchema.parse(JSON.parse(raw)) : null;
  }
  const queue: Queue = {
    enqueue: async (t) => {
      await execute(partition(t), "enqueue", [JSON.stringify(ticket.parse(t))]);
    },
    remove: async (t) => {
      await execute(partition(t), "remove", [JSON.stringify(ticket.parse(t))]);
    },
    claim: async (p) => parseClaim(await execute(p, "claim", [String(p.capacity), randomUUID()])),
    expired: async (p) => parseClaim(await execute(p, "expired")),
    finish: async (p, c, tickets) => {
      await execute(p, "finish", [
        c.reservationId,
        JSON.stringify(tickets.map((t) => ticket.parse(t))),
      ]);
    },
    consume: async (userId, kind) => {
      try {
        if (!client.isReady || !z.uuid().safeParse(userId).success) throw new Error();
        const result = await client.withAbortSignal(AbortSignal.timeout(1000)).eval(rateScript, {
          keys: [`${prefix}:rate:${kind}:${userId}`],
          arguments: [
            String({ search: searchLimit, read: readLimit, cancel: cancelLimit }[kind]),
            String(window),
          ],
        });
        if (result !== 0 && result !== 1) throw new Error();
        return result === 1;
      } catch {
        throw new Error("Matchmaking rate limit unavailable");
      }
    },
  };
  return Object.freeze({
    queue: Object.freeze(queue),
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
        if (client.isOpen) client.destroy();
        throw new Error("Matchmaking queue connection failed");
      } finally {
        clearTimeout(timer);
      }
    },
    close() {
      if (client.isOpen) client.destroy();
    },
  });
}

import type { createDatabase } from "@hambazi/database";
import {
  matchDomainEventSchema,
  outboxPolicySchema,
  type MatchOutboxPort,
  type OutboxClaim,
  type OutboxPolicy,
  type OutboxEvent,
  type MatchDomainEvent,
} from "../../application/outbox.js";

export function createMatchOutboxRepository<T extends OutboxEvent = MatchDomainEvent>(
  database: ReturnType<typeof createDatabase>,
  options: {
    clock: { nowMs(): number };
    policy: OutboxPolicy;
    decode?: (input: unknown) => T | null;
  },
): MatchOutboxPort<T> {
  const policy = outboxPolicySchema.safeParse(options.policy);
  if (!policy.success) throw new Error("Invalid outbox policy");
  const { leaseMs, maxAttempts, backoffMs, maxBackoffMs } = policy.data;
  const scope = database.forModule("outbox");
  function now() {
    const at = options.clock.nowMs();
    if (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000 - 3600000)
      throw new Error("Invalid outbox clock");
    return new Date(at);
  }
  function identity(id: string, attempt: number) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
      !Number.isInteger(attempt) ||
      attempt < 1 ||
      attempt > 2147483647
    )
      throw new Error("Invalid outbox claim");
  }
  return {
    async claim(limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error("Invalid outbox batch");
      return scope.transaction(async (db) => {
        const at = now();
        const ids = await db.lockDueOutbox(at, limit);
        const claims: OutboxClaim<T>[] = [];
        for (const id of ids) {
          const row = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
          if (
            row.attempts >= 2147483647 ||
            (row.claimedUntil !== null && row.attempts >= maxAttempts)
          ) {
            await db.outboxEvent.update({
              where: { id },
              data: { status: "FAILED", claimedUntil: null },
            });
            continue;
          }
          // attempt is a monotonic fencing token; claim expiry permits crash recovery.
          await db.outboxEvent.update({
            where: { id },
            data: {
              attempts: { increment: 1 },
              claimedUntil: new Date(at.getTime() + leaseMs),
            },
          });
          const raw = {
            schemaVersion: row.schemaVersion,
            eventId: row.id,
            aggregateId: row.aggregateId,
            type: row.type,
            occurredAt: row.createdAt.getTime(),
            payload: row.payloadJsonb,
            correlation: {
              ...(row.requestId === null ? {} : { requestId: row.requestId }),
              ...(row.traceparent === null ? {} : { traceparent: row.traceparent }),
            },
          };
          const decoded = options.decode
            ? options.decode(raw)
            : (() => {
                const parsed = matchDomainEventSchema.safeParse(raw);
                return parsed.success ? (parsed.data as unknown as T) : null;
              })();
          claims.push({
            eventId: id,
            attempt: row.attempts + 1,
            event: decoded,
          });
        }
        return claims;
      });
    },
    async published(eventId, attempt) {
      identity(eventId, attempt);
      const at = now();
      const result = await scope.execute((db) =>
        db.outboxEvent.updateMany({
          where: { id: eventId, status: "PENDING", attempts: attempt, claimedUntil: { gt: at } },
          data: { status: "PUBLISHED", publishedAt: at, claimedUntil: null },
        }),
      );
      return result.count === 1;
    },
    async failed(eventId, attempt, permanent = false) {
      identity(eventId, attempt);
      const at = now();
      const delay = Math.min(maxBackoffMs, backoffMs * 2 ** Math.min(attempt - 1, 30));
      const result = await scope.execute((db) =>
        db.outboxEvent.updateMany({
          where: { id: eventId, status: "PENDING", attempts: attempt, claimedUntil: { gt: at } },
          data: {
            status: permanent || attempt >= maxAttempts ? "FAILED" : "PENDING",
            claimedUntil: null,
            nextAttemptAt: new Date(at.getTime() + delay),
          },
        }),
      );
      return result.count === 1;
    },
    async redrive(eventId) {
      identity(eventId, 1);
      const result = await scope.execute((db) =>
        db.outboxEvent.updateMany({
          where: {
            id: eventId,
            status: { in: ["FAILED", "PUBLISHED"] },
            attempts: { lt: 2147483647 },
          },
          data: { status: "PENDING", publishedAt: null, claimedUntil: null, nextAttemptAt: now() },
        }),
      );
      return result.count === 1;
    },
  };
}

import type { MatchCorrelation } from "../../application/correlation.js";
import { hash, randomUUID } from "node:crypto";
import { DatabaseError, type createDatabase } from "@hambazi/database";
import { MatchFault, type MatchAck } from "../../application/processing.js";
import {
  reconnectPolicySchema,
  reconnectTimeSchema,
  type ReconnectPolicy,
  type ReconnectRepository,
  type ReconnectRequest,
  type ReconnectResult,
} from "../../application/reconnect.js";

export function createMatchReconnectRepository(
  database: ReturnType<typeof createDatabase>,
  options: { clock: { nowMs(): number }; policy: ReconnectPolicy },
): ReconnectRepository {
  const policy = reconnectPolicySchema.parse(options.policy);
  const scope = database.forModule("matches");
  type Client = Parameters<Parameters<typeof scope.transaction>[0]>[0];
  async function apply(
    db: Client,
    request: ReconnectRequest,
    correlation: MatchCorrelation,
  ): Promise<ReconnectResult> {
    const row = await db.lockMatchPresence(request.matchId);
    const foundPlayer = await db.matchPlayer.findUnique({
      where: { matchId_userId: { matchId: request.matchId, userId: request.playerId } },
    });
    if (!row || !foundPlayer) throw new MatchFault("NOT_FOUND");
    const player = foundPlayer;
    const at = reconnectTimeSchema.safeParse(options.clock.nowMs());
    if (!at.success || at.data > 8640000000000000 - 86400000)
      throw new MatchFault("INTERNAL_ERROR");
    const now = at.data;
    let epoch = player.connectionEpoch;
    let status = player.connectionStatus;
    let deadline = player.disconnectDeadlineAt?.getTime() ?? null;
    let disconnectedAt = player.disconnectedAt;
    let replacedAt = player.replacedAt;
    let version = row.stateVersion;
    let seq = row.lastEventSeq;
    let changed = false;
    const replaced = () =>
      player.agentType === "BOT" || replacedAt !== null || status === "REPLACED_BY_BOT";
    const result = (): ReconnectResult => ({
      schemaVersion: 1,
      matchId: row.id,
      stateVersion: version,
      lastEventSeq: seq,
      connectionEpoch: epoch,
      role: replaced() ? "SPECTATOR" : "PLAYER",
      status: replaced() ? "REPLACED_BY_BOT" : (status as "CONNECTED" | "DISCONNECTED"),
      changed,
      timeout:
        row.status === "ACTIVE" && !replaced() && status === "DISCONNECTED" && deadline !== null
          ? {
              schemaVersion: 1,
              matchId: row.id,
              playerId: player.userId,
              expectedConnectionEpoch: epoch,
              expectedStateVersion: version,
              deadlineAt: deadline,
            }
          : null,
    });
    // Terminal matches and replaced seats never regain human authority, including delayed renewals.
    if (row.status === "FINISHED" || row.status === "TERMINATED" || replaced()) return result();
    if (row.status !== "ACTIVE") throw new MatchFault("GAME_STATE_CONFLICT");
    if (!["CONNECTED", "DISCONNECTED"].includes(status)) throw new MatchFault("INTERNAL_ERROR");
    // A stale timeout must not even normalize presence or pin policy.
    if (
      request.kind === "TIMEOUT" &&
      (request.expectedConnectionEpoch !== epoch ||
        request.expectedStateVersion !== version ||
        request.deadlineAt !== deadline ||
        status !== "DISCONNECTED" ||
        deadline === null ||
        now < deadline)
    )
      return result();
    const storedPolicy =
      row.reconnectPolicyJsonb === null
        ? policy
        : reconnectPolicySchema.parse(row.reconnectPolicyJsonb);
    const events: {
      type: string;
      payload: { playerId: string; occurredAt: number; connectionEpoch: number };
    }[] = [];
    function mark(type: string) {
      changed = true;
      events.push({
        type,
        payload: { playerId: player.userId, occurredAt: now, connectionEpoch: epoch },
      });
    }
    if (request.kind === "CONNECT" || request.kind === "RENEW") {
      if (request.sessionExpiresAt <= now) throw new MatchFault("UNAUTHENTICATED");
      const lease = await db.matchConnectionLease.findUnique({
        where: { matchId_connectionId: { matchId: row.id, connectionId: request.connectionId } },
      });
      if (
        lease &&
        (lease.userId !== player.userId ||
          lease.sessionExpiresAt.getTime() !== request.sessionExpiresAt)
      )
        throw new MatchFault("FORBIDDEN");
      if (lease && (lease.closedAt !== null || lease.leaseUntil.getTime() <= now))
        throw new MatchFault("GAME_STATE_CONFLICT");
      if (!lease && request.kind === "RENEW") throw new MatchFault("GAME_STATE_CONFLICT");
      if (!lease) {
        const count = await db.matchConnectionLease.count({
          where: {
            matchId: row.id,
            userId: player.userId,
            closedAt: null,
            leaseUntil: { gt: new Date(now) },
          },
        });
        if (count >= storedPolicy.maxConnections || epoch >= 2147483647)
          throw new MatchFault("GAME_STATE_CONFLICT");
        await db.matchConnectionLease.create({
          data: {
            matchId: row.id,
            userId: player.userId,
            connectionId: request.connectionId,
            sessionExpiresAt: new Date(request.sessionExpiresAt),
            leaseUntil: new Date(Math.min(now + storedPolicy.leaseMs, request.sessionExpiresAt)),
          },
        });
        epoch++;
        status = "CONNECTED";
        deadline = null;
        disconnectedAt = null;
        mark("PLAYER_RECONNECTED_V1");
      } else if (request.kind === "RENEW") {
        // Monotonic renewals; duplicate CONNECT never extends the original lease.
        await db.matchConnectionLease.update({
          where: { matchId_connectionId: { matchId: row.id, connectionId: request.connectionId } },
          data: {
            leaseUntil: new Date(
              Math.max(
                lease.leaseUntil.getTime(),
                Math.min(now + storedPolicy.leaseMs, request.sessionExpiresAt),
              ),
            ),
          },
        });
        // Under the same Match lock, this owned, open lease was already live
        // and is extended monotonically. Another live-lease lookup cannot
        // change the outcome; renewal neither connects nor changes authority.
        if (row.reconnectPolicyJsonb === null)
          await db.match.update({
            where: { id: row.id },
            data: { reconnectPolicyJsonb: storedPolicy },
          });
        return result();
      }
    } else if (request.kind === "DISCONNECT") {
      const lease = await db.matchConnectionLease.findUnique({
        where: { matchId_connectionId: { matchId: row.id, connectionId: request.connectionId } },
      });
      if (!lease) throw new MatchFault("NOT_FOUND");
      if (lease.userId !== player.userId) throw new MatchFault("FORBIDDEN");
      if (lease.closedAt === null)
        await db.matchConnectionLease.update({
          where: { matchId_connectionId: { matchId: row.id, connectionId: request.connectionId } },
          data: {
            closedAt: new Date(now),
            leaseUntil: new Date(Math.min(now, lease.leaseUntil.getTime())),
          },
        });
    }
    const live = await db.matchConnectionLease.findFirst({
      where: {
        matchId: row.id,
        userId: player.userId,
        closedAt: null,
        leaseUntil: { gt: new Date(now) },
      },
      select: { connectionId: true },
    });
    if (request.kind === "TIMEOUT") {
      if (live) return result();
      status = "REPLACED_BY_BOT";
      replacedAt = new Date(now);
      mark("PLAYER_BOT_TAKEOVER_V1");
    } else if (!live && deadline === null) {
      const last = await db.matchConnectionLease.findFirst({
        where: { matchId: row.id, userId: player.userId },
        orderBy: { leaseUntil: "desc" },
        select: { leaseUntil: true },
      });
      // Missing callback: grace starts at lease expiry, never at recovery/reconciliation time.
      // A never-connected active seat starts grace at activation.
      const lostAt = Math.min(now, last?.leaseUntil.getTime() ?? row.startedAt?.getTime() ?? now);
      status = "DISCONNECTED";
      disconnectedAt = new Date(lostAt);
      deadline = lostAt + storedPolicy.graceMs;
      mark("PLAYER_DISCONNECTED_V1");
    }
    if (row.reconnectPolicyJsonb === null)
      await db.match.update({
        where: { id: row.id },
        data: { reconnectPolicyJsonb: storedPolicy },
      });
    if (events.length) {
      if (version >= 2147483647 || seq > 2147483647 - events.length)
        throw new MatchFault("GAME_STATE_CONFLICT");
      version++;
      await db.matchPlayer.update({
        where: { matchId_userId: { matchId: row.id, userId: player.userId } },
        data: {
          connectionEpoch: epoch,
          connectionStatus: status,
          disconnectedAt,
          disconnectDeadlineAt: deadline === null ? null : new Date(deadline),
          replacedAt,
          agentType: replacedAt === null ? "HUMAN" : "BOT",
        },
      });
      for (const event of events)
        await db.gameEvent.create({
          data: {
            id: randomUUID(),
            matchId: row.id,
            seq: ++seq,
            schemaVersion: 1,
            type: event.type,
            actorUserId: null,
            payloadJsonb: event.payload,
            createdAt: new Date(now),
          },
        });
      await db.match.update({
        where: { id: row.id },
        data: { stateVersion: version, lastEventSeq: seq },
      });
      const ack: MatchAck = {
        schemaVersion: 1,
        matchId: row.id,
        actionId: randomUUID(),
        stateVersion: version,
        lastEventSeq: seq,
        status: "ACTIVE",
      };
      await db.processedCommand.create({
        data: {
          matchId: row.id,
          actionId: ack.actionId,
          actorUserId: null,
          schemaVersion: 1,
          expectedVersion: row.stateVersion,
          resultingVersion: version,
          requestDigest: hash("sha256", JSON.stringify(request)),
          resultJsonb: ack,
          createdAt: new Date(now),
        },
      });
      await db.outboxEvent.create({
        data: {
          id: randomUUID(),
          aggregateId: row.id,
          type: "MATCH_CHANGED_V1",
          schemaVersion: 1,
          payloadJsonb: {
            schemaVersion: 1,
            matchId: row.id,
            stateVersion: version,
            lastEventSeq: seq,
            status: "ACTIVE",
          },
          status: "PENDING",
          requestId: correlation.requestId ?? null,
          traceparent: correlation.traceparent ?? null,
          nextAttemptAt: new Date(now),
          createdAt: new Date(now),
        },
      });
    }
    return result();
  }
  return {
    async apply(request, correlation = {}) {
      for (let attempt = 0; ; attempt++) {
        let fault: MatchFault | undefined;
        try {
          return await scope.transaction(async (db) => {
            try {
              return await apply(db, request, correlation);
            } catch (error) {
              if (error instanceof MatchFault) fault = error;
              throw error;
            }
          });
        } catch (error) {
          if (fault) throw fault;
          if (
            !(error instanceof DatabaseError) ||
            error.code !== "DATABASE_TRANSACTION_CONFLICT" ||
            attempt >= 2
          )
            throw error;
        }
      }
    },
  };
}

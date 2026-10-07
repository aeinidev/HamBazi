import { createCorrelation, currentCorrelation } from "@hambazi/observability";
import { randomUUID } from "node:crypto";
import type {
  MatchReconnectPort,
  MatchResyncPort,
  MatchSnapshot,
  DisconnectTimeout,
} from "../matches/index.js";

/** One object per real authenticated transport. Calls are serialized by its adapter. */
export function createPresencePort(deps: {
  reconnect: MatchReconnectPort;
  resync: MatchResyncPort;
  cancelTimeout?: (timeout: DisconnectTimeout) => Promise<void>;
}) {
  return Object.freeze({
    open(identity: { userId: string; sessionExpiresAt: number }) {
      const connectionId = randomUUID();
      const subscriptions = new Map<string, boolean>();
      let closed = false;
      const lease = (matchId: string) => ({
        schemaVersion: 1 as const,
        matchId,
        playerId: identity.userId,
        connectionId,
        sessionExpiresAt: identity.sessionExpiresAt,
      });
      function touch(matchId: string, deliverView: true): Promise<MatchSnapshot>;
      function touch(matchId: string, deliverView: false): Promise<void>;
      async function touch(matchId: string, deliverView: boolean): Promise<MatchSnapshot | void> {
        if (closed) throw new Error("Presence closed");
        const context = currentCorrelation() ?? createCorrelation();
        const snapshot = await deps.resync.snapshot(identity.userId, { schemaVersion: 1, matchId });
        if (!snapshot.ok) throw new Error("Presence projection unavailable");
        if (snapshot.value.status === "ACTIVE" && snapshot.value.role === "PLAYER") {
          // Record the attempted identity before I/O: disconnect must close a lease even after an uncertain commit.
          const registered = subscriptions.get(matchId) === true;
          const prior =
            !registered && deps.cancelTimeout
              ? await deps.reconnect.reconcile(
                  {
                    schemaVersion: 1,
                    matchId,
                    playerId: identity.userId,
                  },
                  context,
                )
              : null;
          if (prior && !prior.ok) throw new Error("Presence reconciliation unavailable");
          subscriptions.set(matchId, true);
          const result = await (registered ? deps.reconnect.renew : deps.reconnect.connect)(
            lease(matchId),
            context,
          );
          if (!result.ok) throw new Error("Presence lease unavailable");
          if (prior?.ok && prior.value.timeout) {
            // Queue availability must not delay resync or subsequent healthy heartbeats.
            try {
              void deps.cancelTimeout!(prior.value.timeout).catch(() => {});
            } catch {
              /* best effort */
            }
          }
          if (deliverView) {
            const fresh = await deps.resync.snapshot(identity.userId, {
              schemaVersion: 1,
              matchId,
            });
            if (!fresh.ok) throw new Error("Presence projection unavailable");
            return fresh.value;
          }
          // Registration heartbeats publish no view. Lease guards already own
          // any intervening role/lifecycle change; a second projection is unused.
          return;
        }
        if (deliverView) return snapshot.value;
      }
      return Object.freeze({
        async subscribe(matchId: string) {
          if (!subscriptions.has(matchId)) subscriptions.set(matchId, false);
          return touch(matchId, true);
        },
        async heartbeat() {
          for (const [matchId, registered] of subscriptions) {
            if (!registered) {
              await touch(matchId, false); // Preserve registration after pre-activation subscription.
              continue;
            }
            // Renewal owns the locked membership/role/terminal/lease/expiry guards.
            // Heartbeats transmit no view: constructing two discarded game projections
            // adds database and engine work without strengthening those guards.
            const result = await deps.reconnect.renew(
              lease(matchId),
              currentCorrelation() ?? createCorrelation(),
            );
            if (!result.ok) throw new Error("Presence lease unavailable");
          }
        },
        async close() {
          if (closed) return;
          closed = true;
          const results = await Promise.allSettled(
            [...subscriptions]
              .filter(([, registered]) => registered)
              .map(async ([matchId]) => {
                const result = await deps.reconnect.disconnect(
                  {
                    schemaVersion: 1,
                    matchId,
                    playerId: identity.userId,
                    connectionId,
                  },
                  currentCorrelation() ?? createCorrelation(),
                );
                if (!result.ok && result.error.code !== "NOT_FOUND")
                  throw new Error("Presence close unavailable");
              }),
          );
          subscriptions.clear();
          if (results.some((r) => r.status === "rejected"))
            throw new Error("Presence close unavailable");
        },
      });
    },
  });
}
export type PresencePort = ReturnType<typeof createPresencePort>;

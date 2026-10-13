# Kahroba multiplayer integration — local K2

[ADR-065](../adr/065-kahroba-local-multiplayer-and-shared-results.md) records authorization, versioning and rollout constraints. The trusted `createKahrobaMatchGame` and `kahrobaMatchDescriptor` composition exports support standard mode at 2/3/4 seats. No live runtime registers them; the public catalog remains Coup-only and disabled, and web/personal staging paths are unchanged.

## Existing platform path

Rooms → private-room coordinator or Redis matchmaking → durable Match admission/pins → readiness/start/activation → existing Match writer → audit/receipt/outbox/result → recipient-safe resync or dual-version statistics Worker.

The writer binds the authenticated actor to a human, unreplaced durable seat, locks the Match, checks actionId intent digest/expectedVersion, restores the exact game pins and runs the pure engine. Existing bounded retries apply only to known aborted transaction conflicts. The complete snapshot, sequenced events, receipt, immutable finish result and wake-up/finish outbox commit atomically. Failed rules or writes roll back; uncertain responses can retry the same ID. Gateway never accepts a client-selected user, seat, rules, pins or authoritative balances.

## Visibility and recovery

The adapter validates restored state and roster, and returns only the explicit engine PlayerView/SpectatorView. Public delivery continues to send empty audit invalidations and fresh per-recipient snapshots. Owner reservations appear only in their owner's player view; no internal events, hidden decks, unused nobles or raw snapshots are transmitted. Replaced seats receive only spectator projection and cannot issue commands.

Existing PostgreSQL connection leases, session expiry, epoch/version fences and resync sequencing apply unchanged. Reconstructing services retains engine state, starter/deck/rules pins, receipts and null deadlines. Redis loss does not erase durable matches/results. Existing outbox redrive and statistics rebuilding recover queue/projection loss. No unapproved human timer/fallback is active; a Worker may execute only the explicit bot policy for an already committed BOT seat.

## Result compatibility

K1's local result stays unchanged. Composition maps it to strict platform result schema 2: placements, winnerId, all winnerIds, explicit outcome, reason and bounded numeric metrics. Finish envelope/event schema 2 is restricted to Kahroba. The existing JSONB/result-version columns support it without a migration. Every co-winner's seat boolean is true; shared winnerId remains null. Dual readers and consumers preserve v1 Coup records and jobs exactly.

Statistics owns receipt/effect transactions and generation/Match/digest uniqueness. Each winner gains one win per completed Match; retries and rebuild/live overlap cannot award extra credit. Existing Coup loss/win and HTTP contract behavior remain unchanged. No Kahroba leaderboard route is enabled.

## Local verification inventory

Run the declared root command `pnpm test:kahroba:local` after frozen-lockfile installation. It builds real dependencies, creates exclusively harness-owned loopback PostgreSQL/Redis services using existing locked image/bootstrap helpers, initializes the existing schema, and runs database, API and Worker integration files directly through Vitest (no Turbo test cache). The inventory includes existing Coup/Anarchist suites and new `kahroba.test.ts` suites. Services/volume/network/temporary secrets are cleaned up; failed cleanup preserves the private directory and reports failure.

New tests distinguish complete real games from synthetic invariant-valid shared-victory edge snapshots. They exercise transactions, races, rollback fault injection over real PostgreSQL, JWT/Socket transport, owner-safe snapshots/catchup, disconnect/reconnect, fresh API and Worker processes, actual PostgreSQL/Redis restarts, queue retries and rebuilding. Local admission/rate fixture stubs and synthetic Telegram verification are explicitly test-only; no live Telegram credentials or production capacity claim is involved.

K3 may consume the existing v1 snapshot envelope containing the schema-1 Kahroba view. UI work and any availability changes require their next authorized phase.

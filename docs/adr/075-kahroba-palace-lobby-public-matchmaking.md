# ADR 075: Kahroba palace lobby and two-to-four-player matchmaking

- Status: Accepted for implementation; deployment remains subject to the existing release process
- Owner: HamBazi owner
- Date: 2026-10-22
- Supersedes: ADR 072 owner-only creation/two-seat UI restrictions; ADR 065 runtime matchmaking exclusion for the Kahroba namespace

## Context

The owner approved integrating the latest palace lobby into the real mobile web application, and explicitly requested three- and four-player rooms and public matchmaking. The approved prototype contains local timers and fictional participants; these cannot establish real membership, readiness or outcomes.

## Decision

Render the approved palace assets and controls in React under the existing Kahroba route boundary. Use the authenticated account name/photo. Preserve the absence of online counters. Retain the prototype's local sound/motion preferences; these contain no identity or credentials. Real Rooms owns private invitations/membership/host transfer, and Matches owns durable readiness and the final host start. All admitted users may create private rooms with capacity 2, 3 or 4.

The public choice and room search enter the existing standard matchmaking partition for the selected capacity. “Public” means discoverable to other admitted players in that queue; it does not bypass admission or expose private invite codes. A matched group is a MATCHMAKING Match rather than a fabricated private Room. The first persisted seat is its host. Existing Redis Lua coordination, PostgreSQL reservation commit, cancellation fencing and admission credentials remain authoritative. Reserve/cancel lock their Match-owned ticket rows in UUID order before inspecting them. The database boundary recognizes only known aborted raw-lock transaction conflicts, keeping other failures uncertain and redacted. Admission also uses the existing Rooms retry policy after known aborted serializable transactions: five attempts with four jittered waits totaling 150–300 ms, all after rollback. This allows the competing cancellation/commit to complete instead of exhausting immediate retries; uncertain outcomes remain retryable through their durable receipts. Admission signing keys are derived from the existing rotating auth keys with a dedicated HMAC context and distinct JWT type/audience. Credentials live only in memory.

Use a five-minute search lifetime, ten-second reservation and sixty-second admission credential. These are bounded operational lifetimes, not game-turn timers or launch-capacity targets. Authenticated search/status requests perform one bounded trusted queue tick for their own partition. Status reads reconcile expired reservations and repopulate Redis after a queue loss; durable reads and cancellation remain available during Redis failure. No background interval or additional service is required. If all clients disconnect, matching resumes when an admitted client reconnects and reads its ticket.

Add a Matches-owned member-only public lobby projection containing roster/readiness/version/status, with no engine state. Member reads idempotently recover CREATED → WAITING_FOR_PLAYERS and previously authorized STARTING → ACTIVE. They never start a fully ready waiting game. Only the persisted host may request START; the existing single-writer processor checks every durable readyAt and expectedVersion, recording actionId in the same transaction. Host cancellation is limited to a waiting lobby and uses the same transaction/version/idempotency checks. Private cancellation also closes its bound room through the existing port. Before the roster is frozen, ordinary room leave retains the existing host-transfer rule.

Current-ticket discovery is membership bound and reads PostgreSQL, allowing refresh/reconnect without persisting a token or ticket in browser storage. Finished/terminated matches stop appearing in recovery. An active replaced seat still recovers its table and receives the existing SpectatorView; replacement never grants readiness or command authority. The additive surface is documented in kahroba.lobby.v2.json; historical named-app v1/Main-app v2/lobby v1 contract snapshots are retained.

## Alternatives

- Prototype readiness timers and sample names were rejected because they cannot authorize real multiplayer play.
- A second matchmaking implementation or direct queries across module boundaries were unnecessary.
- Creating public Room rows as well as Match rows would duplicate roster ownership and introduce a cross-module transaction.
- Automatically starting when the last player becomes ready would violate the approved explicit host-start flow.

## Consequences

No database migration, engine pin change, public catalog activation, new infrastructure or new dependency is needed. Existing runtime/admission flags and cohort files still control access. Four-player staging play requires four admitted identities through a separately approved admission configuration; this implementation does not edit those files or deploy. Existing active Match pins, reconnect/bot replacement rules and v1/v2 result consumers remain in force. Public pregame recovery requires a member read after an interrupted start. Operational launch/load/SLO decisions remain open.

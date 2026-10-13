# Kahroba isolated game module — K1

`@hambazi/kahroba-engine` follows the existing pure TypeScript/Zod workspace convention. It depends at runtime only on Zod and the documented game-core package, with no I/O, framework, ambient clock/randomness or startup side effects. [ADR-064](../adr/064-kahroba-rules-and-isolated-engine.md), [rules](kahroba-rules.md) and [dataset verification](../testing/kahroba-dataset.md) record the approved scope.

## Versions and exported module

Engine `kahroba-v1`; state 1; ruleset `kahroba-base-v1`; dataset `kahroba-economy-v1`; command/event/view 1. `kahrobaModule` exports manifest/descriptor, engine, schemas, deterministic bot policy, timer/reconnect policies, presentation adapter, current-state restoration and event validation/upcasting. Manifest status is DISABLED and capability flags are false. No catalog, API, worker or browser runtime registers it.

Initialization requires unique server-supplied player UUIDs, an injected Clock, unbiased RandomSource and explicit rules. It shuffles three verified decks and nobles, persists the randomly selected starting seat, and freezes the resulting state. No seed is accepted or separately retained. Every random integer is checked against its requested bound.

## Commands and complete turns

`TAKE_TOKENS`, `BUY_CARD`, `RESERVE_CARD` and guarded `PASS` are strict intent schemas. Optional return/noble choices are gathered before execution. The engine validates against a detached state, resolving payment/collection, ownership, refill, excess return, noble acquisition and finish/turn advancement as one complete transition. Failure changes neither input nor caller-owned command. Output is one `TURN_RESOLVED` event with expected revision, actor, validated command, server time, trusted origin, policy version and resulting deadline.

`execute` and `applyEvent` have the standard game-core shape. Turns draw from the already persisted deck order, so they use no fresh randomness. Replay checks revision, actor, legal choice, time/policy origin and deadline and produces the same frozen state. Duplicate/stale replay is rejected. Restoration validates pins, card/noble/token conservation, ownership, tier/slot shape, seats/turn counters, holdings, noble eligibility, deadlines and final-round consistency. It validates current v1 only; no history is invented for unknown versions.

Engine revision is independent of future Match stateVersion/actionId. This package provides no database transaction, credential validation, command receipt, websocket, outbox or worker scheduling. Those belong to K2 and existing application ports.

## Views, bots and presentation

PlayerView contains public board/players, owner reservations, owner purchase options with authoritative effective costs/affordability/noble candidates, and complete default commands per primary/noble choice. Those defaults are not an exhaustive enumeration of every legal payment or return allocation; custom allocations still pass normal engine validation. SpectatorView omits private cards, purchase options and commands. Every projection is explicit, strict and deeply frozen; no raw state or event is a public payload.

`kahroba-bot-v1` validates and consumes exactly PlayerView. It prioritizes scoring purchases, then token coverage toward a known affordable goal, with deterministic public-information reservation/collection choices. It uses no opponent reservation/deck knowledge and is not a selected human timeout fallback. All its output must pass ordinary engine validation.

The frontend adapter validates supported public views and declares a future renderer/route only. It ships no React screen or artwork in K1. Original owner-supplied Kahroba assets remain the later UI source. Reconnect projection verifies membership; a trusted replaced seat gets only SpectatorView and cannot reclaim control under the existing MVP policy.

## Timing and results

`turnDurationMs` and `timeoutPolicyVersion` must be both null or explicitly supplied. No runtime duration, default rule object, automatic fallback or scheduler is exported. `getDeadline` returns a revision/deadline guard or null. Trusted `executeTimeout` requires a matching caller-supplied versioned policy which receives only PlayerView; null output does nothing. A due accepted command commits through the same reducer. Early/stale/duplicate guards are harmless and a delayed move derives the next deadline from its actual accepted time. Reconnect never changes persisted timing.

`KahrobaResult` has local schema 1, all winning IDs, score/card-count/placement rows, reason and bounded non-sensitive numeric metrics. A sole winner also sets the structural `winnerId`; shared winners leave it null. It extends game-core structurally without modifying that package. **The platform's current strict v1 result parser rejects the added Kahroba fields**, and its statistics use a single winning ID. K2 must implement an explicit approved mapper/versioned compatibility path; directly wiring this result into persistence is unsupported.

## Verification and remaining boundaries

Tests verify the economic source snapshots, every capacity, legal/invalid actions, shortage and holding limits, payment choices, hidden reservations, exhausted tiers, multi-noble decisions, all starting/trigger-seat final-round boundaries, shared winners, invariant/model sequences, bot completion, timer guards and corrupt restoration. Checked-in synthetic v1 fixtures replay complete 2/3/4-player games, including one explicitly fixture-selected timeout each, to exact states, early views and results. Fixtures are not live Telegram or historical application data.

K2 requires trusted API composition, CSPRNG adapter, retained pins, public contracts, result mapping and real transactional/idempotency/recovery tests. Runtime timing/fallback selection, private admission and staging execution still need their own approved scope. No migration, service deployment, public activation or existing-game semantics changes occur in K1.

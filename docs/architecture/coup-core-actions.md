# Phase 10B offline Coup core actions

The `@hambazi/coup-engine` public surface now includes `coupCoreEngine` and
separate command/event/view functions. It remains a disabled offline Game Module:
the Games catalog still reports `descriptor: null`, and no Match, Socket, Bot,
Worker or frontend path invokes the engine. [ADR-018](../adr/018-read-only-game-catalog.md)
and the Phase 7C activation gate remain in force.

## Provisional versions and rules

Core actions use engine `coup-core-v1`, state schema 2 and ruleset
`coup-provisional-core-v1`. The Phase 10A foundation descriptor (`coup-foundation-v1`,
state schema 1) remains available but is not executable. No persisted Match uses
either version, and no foundation-state migration is claimed; migration/upcasting
and compatibility fixtures are Phase 10D deliverables. Command and event schema
versions remain 1 because core intent shapes are unchanged and
`PLAYER_ELIMINATED` is an additive internal event. No public transport event
catalog or OpenAPI shape changes in this phase.

The server injects and snapshots coin awards, coup cost and mandatory-coup
threshold with deck/deal rules. Test fixtures use income 1, foreign aid 2, coup
cost 7 and mandatory coup at 10. Those numbers are provisional fixture values,
not production configuration or resolution of OD-008. Rule config validation
requires the threshold to be at least the coup cost. Foreign aid resolves
immediately **without a block window** in this offline 10B ruleset. Phase 10C
must add the Duke block window under an explicitly compatible/new version before
registration; it must not silently change an active pinned Match.

## Transitions and replay

At `WAITING_FOR_ACTION`, the live turn owner may declare income or foreign aid;
the engine emits `ACTION_DECLARED`, an exact `COINS_CHANGED`, then `TURN_STARTED`
for the next live seat. At or above the injected mandatory-coup threshold, only
a coup is accepted. A coup requires enough coins and another live target. It
emits the declaration and charge, then waits for that target's
`SELECT_CARD_TO_LOSE`. The target alone chooses an influence index. The engine
emits `INFLUENCE_LOST`, `PLAYER_ELIMINATED` when appropriate, then either starts
the next live turn or emits `GAME_ENDED` when one live seat remains. Eliminated
seats are skipped. The engine never selects a target's card on the client's
behalf or accepts a claimed outcome in a command.

`execute` produces events by running each through `applyEvent` against a local
working copy. `applyEvent` rechecks order, actor, exact coin delta, influence
role/index, elimination and next seat. It returns a new frozen state and never
mutates the prior one. Replaying the ordered events from the same initial state
reconstructs the state and standard result. Match-level `actionId`,
`expectedVersion`, atomic persistence and outbox remain Phase 11A/11B work.

## Information boundaries

`PlayerView` exposes only the requesting player's live cards plus public seat,
coin, remaining-card and revealed-card information. `SpectatorView` has no
private cards. Neither view includes deck, other influence, random material,
internal rule config or the full pending action. The engine denies unknown
player views. Match membership and spectator authorization must be enforced by
the future Match/Realtime application boundary. Internal state and events are
highly sensitive persistence data and must not be sent directly to clients or
telemetry.

Tests exercise the core action matrix, invalid actors/events, card and coin
invariants, replay, finish/placements, and information flow across 2–6 player
seeded games. Claims, challenges, block resolution, exchange, timers, bot policy
and old-state migration remain later Phase 10 gates.

# Complete pure Coup module — Phase 10D

## Public surface and version matrix

`@hambazi/coup-engine` exports `coupModule`, containing the disabled manifest,
version descriptor, pure `coupEngine`, command/event schemas, timer and reconnect
policies, result mapper through the engine, bot policy, frontend adapter contract,
snapshot migration and event upcaster. Game-core adds structural bot/frontend
adapter interfaces used by this module. It adds no game-specific platform rule.

| Export                     | Engine             | State | Command/event | Ruleset                      | Support                              |
| -------------------------- | ------------------ | ----- | ------------- | ---------------------------- | ------------------------------------ |
| `coupFoundationDescriptor` | coup-foundation-v1 | 1     | 1 / 1         | coup-provisional-v1          | Non-executable historical foundation |
| `coupCoreEngine`           | coup-core-v1       | 2     | 1 / 1         | coup-provisional-core-v1     | Retained core-only semantics         |
| `coupClaimsEngine`         | coup-claims-v1     | 3     | 2 / 2         | coup-provisional-claims-v1   | Retained untimed claims semantics    |
| `coupEngine`               | coup-v1            | 4     | 3 / 3         | coup-provisional-complete-v1 | Complete timed action engine         |

[ADR-022](../adr/022-coup-module-version-and-policies.md) records version isolation,
timeout fallbacks and compatibility decisions. No API/catalog descriptor or mode
is enabled. ADR-018, Phase 7C, game/application integration and OD-008 remain gates.
The new engine accepts explicitly supplied economy/deck/timer settings; it does
not select a production rules profile or change earlier setup conventions.

## Exchange

`DECLARE_EXCHANGE` claims Ambassador and follows the existing challenge flow.
Once verified, draw two cards from the shuffled deck and open an `EXCHANGE`
selection window. Only its actor receives `exchangeChoices`, ordered as current
live cards followed by the two drawn cards. `SELECT_EXCHANGE` carries that window
ID and distinct `cardIndices` identifying exactly as many cards as the actor had
live influence. Revealed cards cannot enter this pool. Return the other two to the
deck and shuffle through the injected unbiased server RandomSource. No ownership
proof is required unless challenged; a conceded action draws nothing.

This follows the [Exchange rule reference](https://www.rulespal.com/coup/rulebook).
The implementation remains provisional and does not imply rights clearance.

State stores the two temporarily drawn cards separately, preserving existing live
hands until selection. Conservation includes deck, live hands, revealed cards and
these drawn cards. Initialization requires two spare deck cards, including for
nonstandard configured card counts. A final successful challenge that leaves one
survivor ends the game without another Exchange choice.

## Timing and replay

Configuration supplies `actionTimeoutMs`, `responseTimeoutMs` and
`decisionTimeoutMs`; all are required positive bounded integers. The engine
snapshots them alongside economic rules. State persists `lastCommandAt` and
`deadlineAt`. Every schema-3 command event records `occurredAt`, the resulting
`deadlineAt` and `source: PLAYER | TIMEOUT`. Replay derives and verifies deadlines
without reading a clock or drawing randomness. It rejects backward timestamps,
incorrect revisions, forged timeout choices and inconsistent deadlines.

| State              | Deadline category | Timeout command                                        |
| ------------------ | ----------------- | ------------------------------------------------------ |
| WAITING_FOR_ACTION | Action            | Income; mandatory Coup targets first other living seat |
| CHALLENGE          | Response          | First remaining eligible seat passes                   |
| BLOCK              | Response          | First remaining eligible seat passes                   |
| PROOF              | Decision          | Prove first owned matching card, otherwise concede     |
| LOSS               | Decision          | Select live card index 0                               |
| EXCHANGE           | Decision          | Keep original live-card indices                        |
| GAME_OVER          | None              | No-op                                                  |

`coupTimerPolicy.getDeadline` returns `{ expectedRevision, deadlineAt }` or null.
`executeCoupTimeout` is a separate trusted server port, not a player command.
Early requests and stale/duplicate guards return no events. Accepted timeouts
return one event through the same validation/reducer as human commands. At exact
expiry ordinary commands fail; timeout wins if its guarded state is current.
Passes do not extend the common window deadline. If other seats still need to
pass, the latest deadline remains expired and the next guarded timeout can run
immediately. New phases receive fresh deadlines relative to actual processing
time, so a delayed job cannot consume the next player's turn budget.

The Match application must persist state/events atomically, refresh scheduling
from the committed revision and serialize human/job races. Engine revision is
not a replacement for Match `expectedVersion` or `actionId`. Worker/job delivery,
connection epochs and disconnect grace belong to later integration. Reconnect
never resets the engine timer. `getCoupReconnectView` takes trusted Match seat
status; after committed bot replacement it returns only SpectatorView, with
membership still required. It is not an authentication or takeover operation.

## PlayerView, bot and frontend contract

View schema 1 includes public state, deadline and response windows. Player views
also identify the viewer, show their live cards and own Exchange pool, and expose
server-computed `legalCommands`. These allow bluff declarations/blocks; proof
choices depend only on the viewer's own hand. Spectator views omit all private
choices and commands. Every projection and emitted event/state is deeply frozen.
Internal events may contain deck outcomes and private choice indices: never send
them directly to clients or telemetry.

`coupBotPolicy` strategy `coup-bot-v1` consumes exactly this PlayerView, never State.
It prefers affordable Coup, truthful blocking and truthful Tax, then the safe
fallback policy. It does not challenge or bluff proactively; this is a simple
single-difficulty deterministic policy. Its output must still pass normal engine
validation and the future Match authorization/version checks.

`coupFrontendAdapter.toPresentation` validates a player or spectator view and
returns it with a phase prompt, server-provided command choices and deadline.
It rejects internal state, unknown versions and hidden extra fields. Route
`/games/coup/:matchId`, renderer key `coup-v1` and an empty asset list define the
future adapter contract. There is no React renderer, bundled asset or Socket
implementation in 10D. Transport envelopes, sequence/gap handling and actual
renderer bindings remain Phases 12/14. Countdown rendering grants no authority.

## Restoration, results and fixtures

`migrateCoupState(input, 4)` validates current snapshots: exact version/schema,
unique seat order/identities, player/card counts, full role inventory, elimination,
turn/pending/window ownership, proof/loss continuation, metrics and time shape.
It returns a detached frozen copy. `upcastCoupEvent(input, 3)` validates and copies
current events; `applyEvent` checks them against the pre-state. Unsupported source
versions and malformed restoration input fail with `INCOMPATIBLE_GAME_VERSION`.
No conversion silently replaces an engine or invents historical timestamps.
Direct commands/events use `INVALID_INPUT` or `GAME_STATE_CONFLICT` as applicable.
Restore/load must use the matching validator before supplying typed state to an
engine. Raw Zod diagnostics are not a telemetry or transport contract.

The result mapper returns winner, elimination-order placements and reason, plus
turn/action counts, elapsed server milliseconds, challenge/proof/concession/block
counts, completed exchanges and accepted timeout count. Metrics contain no cards,
seed, deck, private selections or user text. No partial result exists before end.

The checked-in synthetic fixture corpus lives in `tests/fixtures`: historical
core/claims logs replay to exact frozen snapshots/results, and the complete v1
log has every-phase golden projections for every player and spectator. Tests
also cover 50 mixed command/timeout games over 2–6 seats and 20 differential games
against the retained claims engine, alongside Exchange permutations, deck
conservation, corrupt replay/restoration, deadline/race guards, bot-valid commands
and hidden-state noninterference. Tests do not regenerate fixture expectations.

## Remaining integration gates

Phase 11A supplies Match lifecycle, durable atomic writes, expected versions,
idempotency and the server CSPRNG dependency at composition. Phase 11B dispatches
outbox events, Phase 12 adds realtime/resync and Phase 13 wires reconnect/timer
jobs and bot seat control. Frontend rendering is Phase 14B. Local pure-module
completion is not service integration, staging E2E, live activation or launch
readiness; no database or production configuration changes occur in this phase.

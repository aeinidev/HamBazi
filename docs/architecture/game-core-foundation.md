# Phase 10A game-core and Coup foundation

The public `@hambazi/game-core` surface defines a framework-free `GameEngine`
contract, injected `Clock`, `RandomSource` and `RuleConfig`, standard result,
strict manifest and version-descriptor schemas. A Match must pin engine, state
schema and ruleset versions; command and event schemas also have independent
versions. This package does not choose a runtime clock or randomness adapter.
Production shuffle/draw adapters must supply unbiased CSPRNG integers on the
server. Test seeds are deterministic fixtures only.

`@hambazi/coup-engine` currently exports a **disabled, non-executable** manifest,
foundation descriptor, strict command/event intent schemas, and initial-state
construction. Its version labels (`coup-foundation-v1`, state schema 1,
`coup-provisional-v1`, command/event schema 1) identify the offline model; they
are not registered as an executable catalog descriptor. The approved read-only
catalog still returns `descriptor: null`, `NOT_IMPLEMENTED`, and false effective
capabilities under [ADR-018](../adr/018-read-only-game-catalog.md). No game mode,
timer, activation rule, or production rule configuration has been selected.

Initial-state creation validates two to six unique server-supplied player IDs,
injected rules, epoch-millisecond time, and every integer returned by the random
source. It shuffles a rule-configured deck, deals in seat order, snapshots the
rule configuration, and freezes the state and nested card arrays. The remaining deck and all influence are internal
highly sensitive data. They must never be sent to a client or telemetry. No
`PlayerView`/`SpectatorView`, action execution, replay transition, migration,
bot policy, frontend adapter or timer policy is implemented in 10A. Those are
explicitly assigned to 10B–10D. The current command/event schemas define
foundation v1 shapes; later behavior must validate rule legality and preserve
version compatibility before production use.

The generic `GameEngine` interface specifies the required completed-engine
methods. This phase deliberately exports no Coup object that falsely claims to
implement them. Tests cover manifest/version constraints, strict intent shapes,
input rejection, card conservation for every supported capacity, frozen state,
and repeatability under injected time/randomness. The existing uncached
architecture check enforces the pure-package import and ambient API bans.

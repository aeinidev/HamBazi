# ADR-064: Kahroba base rules, verified economy and isolated engine

- Status: Accepted for Phase K1 by the owner's explicit 2026-10-12 instruction; runtime activation and K2 remain unapproved
- Owner: HamBazi product owner
- Date: 2026-10-12
- Related: ADR-013/014/022/023/027/030/056/058/063; architecture sections 7, 11, 22 and 27
- Supersedes: none; no Coup, Anarchist, admission, session or platform result decision changes

## Context

K0 verified reusable game-core interfaces and platform services, together with Coup-only catalog/runtime/rendering assumptions and a single-winner statistics path. The owner authorized only a pure Kahroba module, exact economic-data verification, safe projections and deterministic tests. Public navigation, admission, staging, production, migrations, commits, platform integration and shared result changes are outside K1.

## Decision

1. Reference the standard base Splendor rules without expansions. Use original Kahroba naming/branding. The [rules specification](../architecture/kahroba-rules.md) distinguishes reference rules from the owner's approved adaptations.
2. Select the initial player through injected server randomness and persist that index. Keep seat order fixed; complete the same round when the prestige threshold is reached. Do not collect age or accept a client-selected starter/seed.
3. Require three distinct available gem colors unless fewer colors remain. Matching-token collection requires four tokens before taking two. Gold is excluded from collection. Return exactly the excess over ten at turn completion; no discretionary discard below that threshold.
4. Keep every reserved identity private to its owner. Other projections receive counts. Previously public cards can be remembered by players, but current snapshots do not repeat those reserved identities.
5. Allow `PASS` only when the engine proves that collection, reservation and purchase are all unavailable. Do not introduce a maximum turn count, automatic draw or voluntary pass.
6. Require an explicit rules object. Timing uses a nullable duration/policy-version pair with no selected runtime duration or default fallback. Trusted timeout execution requires an explicitly supplied matching policy operating on PlayerView. An absent/no-op policy cannot manufacture a move. K1 imports start no scheduler or service.
7. Define shared victory in a Kahroba-owned result extending the existing structural result type. Preserve all winning IDs and equal placements; a shared outcome has `winnerId: null`. Do not change shared interfaces, Match result persistence, finish jobs, statistics or leaderboard semantics. K2 must explicitly map/version this result before using the existing strict persistence schema.
8. Adapt only numeric resources from the MIT-licensed `AchrafAmil/splendor-api` commit `248579fd4099a6f0a519554228a32b5ec6287de9`. Retain its complete notice. Verification and source hashes are recorded in [dataset provenance](../../packages/games/kahroba-engine/dataset-provenance.json) and the [verification record](../testing/kahroba-dataset.md). Do not import its engine or erroneous noble loader.
9. Pin `kahroba-v1`, state 1, `kahroba-base-v1`, economy `kahroba-economy-v1`, command/event/view 1. State stores actual deck order and the rules snapshot, never an independent seed. Restore validates the current version; unsupported versions fail closed. Economic or semantic changes require new pins and compatibility work.
10. Keep the manifest disabled with effective capabilities false. Concrete engine code remains in its owner package, using only the established pure dependencies. No application registers or activates it in K1.

## Alternatives

- Inventing an "official" table or trusting agreeing community claims: rejected; primary card/tile references and exact tuple comparison are required.
- Using an original Kahroba economy: permitted only after separate approval if the exact-data gate fails; that substitute was unnecessary because this dataset passed verification.
- Reusing unlicensed community code or distributing official/GPL reference artwork: rejected; original logic and licensed numerical resources suffice.
- Advancing the primary action before asking for token/noble choices: rejected; a missing choice must leave the original state untouched.
- Selecting the first tied seat as winner or changing platform statistics in K1: rejected by the approved shared-victory and phase boundaries.
- Automatically using the bot as a timeout fallback: rejected; no such runtime policy is approved.

## Consequences

The engine can be exercised offline without changing playable games or infrastructure. Its structural `GameEngine` interface is compatible with game-core; its richer local result is not an authorization to send extra fields into the platform's strict v1 persistence contract. K2 needs an explicit adapter and result compatibility decision. Runtime duration/fallback, private rollout, public rights/availability and native Telegram acceptance remain later gates.

Photographs and scans served as inspection references only. The numerical-source MIT grant is recorded; it does not establish publisher endorsement, trademark permission, or publication rights for unrelated artwork. No source rule prose, official art or third-party engine code is shipped. The existing production hold remains.

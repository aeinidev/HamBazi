# ADR-061 — Shared Anarchist and retained personal Match versions

- Status: Accepted for restricted staging; public release HOLD; native acceptance pending
- Owner: HamBazi product owner
- Date: 2026-10-10

## Context

The owner requested the gameplay layout in `hambazi-game-table-anarchist.md`, then selected five supplied role JPEGs and subtle neon card framing with the supplied HamBazi Display font. Existing lobby, onboarding, support, Telegram presentation, admission and personal request sequencing remain in scope as preserved behavior. Neither reference images nor the implementation attachment decide unspecified game semantics.

The owner explicitly approved automatic defense by a genuinely held live Contessa, public two-second card animation followed by exchange, and a non-refundable five-coin attacker payment. No attacker role claim or bluff defense is permitted. Lost/revealed Contessa does not qualify. The action is shared and never an influence/dealt/exchange role.

## Decision

New personal matches pin `coup-anarchist-v1`, state schema 5, command/event schemas 4 and private/public view schema 2. Old `coup-v1` / state 4 / provisional complete v1 matches retain their exact engine and rules. API reads/writes and worker automation register both adapters. No persisted active match is rewritten, upgraded or reset; no database migration or new public catalog mode is introduced.

The five-coin payment, automatic authoritative defense and replacement outcome commit through the existing atomic, version-checked, idempotent Match writer. A target without a live Contessa enters the existing influence-loss choice/timeout path. A defended target returns one live Contessa to the deck, shuffles using the injected server CSPRNG, and draws one replacement; drawing the same role is possible under the existing proof replacement convention. The turn advances normally. The server does not wait for a client's animation before committing or hold a database transaction open for animation.

Only a legitimate resolved defense produces the public `lastDefense` receipt (revision, timestamp and target seat identity). All clients may animate that publicly shown Contessa for two seconds; the replacement and all other live cards remain private. The local hand is covered by this animation and shows its authoritative replacement when the overlay ends. A receipt is deduplicated within the runtime and stale historical receipts are not animated on reconnect. `lastAction` is a minimal public action summary, not an internal event log. Public `actionRules` carry actual pinned economic amounts for the UI. Neither field contains hidden cards, deck/RNG material or pre-resolution defense availability.

Public display names are resolved through the existing Users application port after the authorized locked Match read. They are optional public metadata in v2 views, never inputs for admission or commands, and never read by querying Users tables from Matches. Avatars use name initials when no profile image is available; synthetic bot seats keep a bot fallback. Old v1 wire views remain unchanged.

The new engine delegates unchanged ordinary transitions to the retained v1 implementation. The sole legacy-shaped continuation is Anarchist's unblocked influence-loss decision, mapped internally to the identical loss mechanism and mapped back to the new pinned semantics. Legacy events are not rewritten at rest. New events have their own schema and replay verifies outcomes without fresh randomness. Restoration checks the legacy invariants plus new continuation/receipt invariants.

The bot receives only its own validated PlayerView. It considers Anarchist at selected five-coin turns while also saving for Coup, so repeated genuine automatic defenses cannot force an endless spend loop. A bot never reads an opponent hand to choose its target. The mandatory Coup threshold remains unchanged.

## Alternatives

- Mutating v1 silently would change in-progress matches and replay, so it is rejected.
- Client assertions of Contessa or manual bluff reactions violate the owner's truthful automatic defense rule.
- Waiting two seconds inside the writer or introducing client-confirmed exchange would make correctness depend on rendering/network timing.
- Introducing Anarchist into the role enum/deck would incorrectly create a sixth dealt role.

## Consequences

Both pinned engines remain available until historical jobs and persisted Matches no longer need the old adapter. The optional shared shortcut is absent from v1 matches; the redesigned table renders both versions. The UI is not authority for legality, payment, target identity or defense. New real-device acceptance remains pending and production/public launch remains HOLD. Fonts and five role images are served locally under the existing CSP. Card framing uses restrained cyan/violet while the requested gameplay structure and existing midnight lobby remain intact.

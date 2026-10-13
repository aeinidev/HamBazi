# Kahroba frontend boundary — Phase K3

See [ADR-066](../adr/066-kahroba-isolated-ui-and-browser-acceptance.md),
[the visual/asset guide](../design/kahroba-ui.md) and
[browser acceptance](../testing/kahroba-ui.md).

## Runtime and transport

The game module exports `KahrobaSession`, `KahrobaMatch`, the public-view parser
and safe snapshot projection. Only `Snapshot.view` is rendered. Pin checks require
`kahroba-v1`, state schema 1, rules `kahroba-base-v1`, view schema 1; commands use
the existing schema-1 platform envelope. K2's outer final-result event schema 2
is not confused with the engine's embedded result schema 1.

Strict public schemas deny hidden fields, foreign viewer/role/pins, incoherent
players and malformed shared results. State/decks/audit events never enter the
adapter. Actual K1 public fixture projections are tested against the schema
mirror in Node. No browser source imports the engine or economic data.

`createRuntime` now accepts a final optional `projectSnapshot` dependency. Existing
callers retain `publicSnapshot` and deny Kahroba. The separate guarded preview
passes `publicKahrobaSnapshot`; production main, game registry, screens, routes,
admission and authentication remain unchanged.

Commands use existing Socket.IO `game:command`, `match:subscribe` and resync ports.
The command store generates one UUID, captures match/version/intent, blocks
parallel taps and retries an ambiguous failure with the same envelope. It never
optimistically mutates authoritative state. Success/conflict synchronizes the
snapshot; role/session/match/unmount changes discard private intent. The existing
runtime clears views on connection loss and deduplicates/gap-checks invalidations.

## Interaction authority

Legal primary groups and noble variants come from server `legalCommands`.
Affordability/effective cost come from `purchaseOptions`. Colored/gold payment
and return inputs only check that the form is complete before sending a single
atomic command. They do not grant legal action authority. Missing/outdated
projections disable controls and display loading/reconnect/error states.

## Development preview

Run the existing engine build first if `dist` is absent, then from the root:

```sh
pnpm --filter @hambazi/kahroba-engine build
pnpm --filter @hambazi/web dev:kahroba
```

Visit `http://127.0.0.1:4183`. The Node fixture binds only `127.0.0.1:4184` and
uses synthetic credentials/identities, deterministic engine states, receipt and
version checks. Its authenticated case/control endpoints are local-only. It
does not call Telegram, PostgreSQL or any deployed API. The fixture server
imports the engine in Node; the browser receives public projections only.

The Vite config refuses build/production mode; the browser checks development,
exact host/port and synthetic meta. Production bundle verification rejects the
preview markers/routes. The launcher owns and terminates its direct children,
including Vite without a package-manager grandchild. No unrestricted runtime
debug object or persistent token storage is exposed.

Preview states include initial/2–4 players, opponent, affordable, ten-token return,
multiple nobles, reservations, exhausted tier, spectator, invalid pin and both
final outcomes. Rare scenarios start from clearly labelled synthetic invariant-
valid midgame arrangements; commands and final turns still execute the actual
engine. This fixture proves UI interaction, not a replacement for K2's real DB,
transaction, worker and network recovery evidence.

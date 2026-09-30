# Coup Mini App UI — Phase 14B

The Match screen passes the latest versioned server snapshot to the Coup UI.
The game adapter validates the exact `coup-v1` / state schema 4 /
`coup-provisional-complete-v1` / view schema 1 public projection and requires
its role and viewer identity to agree with the authenticated snapshot. Match
`stateVersion` and Coup `revision` are independent counters; only the former is
used in command concurrency control.
Unknown game versions, malformed fields, role mismatches and extra view fields
yield no renderable view or commands. The session store retains only a validated
public projection; raw `view` JSON from the transport is never kept there.

The player table shows public seats, coins, remaining card counts and revealed
cards. Hidden cards use question-mark backs; only the authenticated viewer's
`myCards` and temporary `exchangeChoices` are displayed. Spectators receive
no hand or controls. Every action button is derived from the server-supplied
`legalCommands`; the exchange picker enables submission only when the selected
indices match one of those exact commands. The UI does not import the Coup
engine, infer rules, perform card transitions or decide timeouts. It presents
the server's deadline as a countdown without treating the local clock as
authority. CSS entrance motion respects reduced-motion preference.

Each `game:command` carries schema version 1, a stable UUID action ID, Match ID,
expected snapshot version and the selected command. An ambiguous transport
failure retains the same envelope for explicit retry. A conflict requests a
fresh server snapshot before the next intent. Disconnect, event invalidation
and sequence gap discard the old view; controls stay unavailable until catch-up
applies a newer snapshot. Reconnection may downgrade a player to spectator and
never reuses the previous private hand.

The browser fixture uses the engine's checked-in golden public views and
disposable synthetic identity to exercise every view phase, commands, version
failure and responsive/accessible rendering. Fixture phase transitions test UI
wiring only; they do not simulate or replace the authoritative engine. Local
preview remains a loopback-only development tool. The production catalog
remains disabled pending its existing admission/activation gate. Live Telegram
WebView, staged durable gameplay and actual transport/engine integration are
still separate validations.

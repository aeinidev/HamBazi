# Midnight personal lobby and Coup entry

The registered `owner-auth` session lands on `/games`. Unregistered sessions on
every route retain the existing Persian chosen-name registration gate;
navigation never creates or completes a profile. Admission remains the
server's verified numeric-ID policy, not a frontend username check.

The [home presentation decision](../adr/063-responsive-home-presentation-and-availability.md)
uses a responsive RTL identity header, separate art banner, six two-column cards
and safe-area-aware bottom navigation. The title, chosen name, avatar, status
labels and controls are live UI. [Temporary game availability](game-availability.md)
now comes from authenticated `/v1/games/availability` metadata. Coup defaults to
“موقتاً غیرفعال”; Hokm, Kahroba, Chess, Domino and Ludo retain “به‌زودی”. Inactive
posters use CSS grayscale and charcoal overlays without dimming the text.
Only an explicitly unpaused and already admitted Coup session has an enabled route.
The CTA, all-games control, Friends, Leaderboard and notifications are visibly
disabled. The Settings control continues to the existing editor.

| Route                  | Screen                                                                       | Entry side effects                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/games`               | Responsive home; verified availability                                       | Own profile and availability read                                                          |
| `/profile`             | RTL Profile Hub with pinned identity, avatar picker/crop and real statistics | Own profile/stats read, debounced username availability; explicit patch only               |
| `/games/coup`          | Availability-gated Coup entry                                                | None                                                                                       |
| `/games/coup/tutorial` | Availability-gated tutorial                                                  | None                                                                                       |
| `/settings`            | Existing profile preferences editor                                          | Own profile read; explicit patch only                                                      |
| `/games/coup/play`     | Existing personal game/table                                                 | Personal connection/current lookup; creation only when unpaused with explicit start intent |

Direct future-game routes show an unavailable screen without game requests. The
ordinary Games API still registers only non-playable Coup under ADR-018; future
slugs return 404, room and matchmaking creation reject them, and the personal
start schema cannot name a different game. This personal home presentation does
not activate the ordinary catalog.

Native BackButton returns tutorial/play to entry and entry/settings/profile/
unavailable routes to home. Where a visible back control is present, it shares
that destination. Leaving the table clears its UI timer but never
sends personal close. The existing runtime owns reconnect and memory-only auth;
no token, initData, hidden state, chat content or profile is logged or stored for
UI diagnostics. The personal `/match/<uuid>` route reads that specific match through authorized
subscription; it never uses a URL-supplied user identity. The separate recovery
link finds the current own match without creating one. When Coup is paused,
native BackButton from recovery returns home.

Start guards rapid taps before hash navigation. A failed current lookup cannot
fall through to creation. Network retry uses the original command ID; a committed
but ambiguously acknowledged start resumes the current durable match. The server
remains authoritative for commands, deadlines, snapshots and active-match
uniqueness. Gameplay layout and server rules are unchanged.

The personal gateway accepts only one pending request per socket, independently
of its Redis minute quota. Personal transport requests share a bounded lane
(one on the wire, at most four accepted locally). Two-second catchup, reconnect
lookups and game intents cannot race against that guard. A queued intent retains
its original payload, action ID and expected version; a disconnected or replaced
connection rejects it without transmitting it on the next connection. Quota
rejections are still surfaced without automatic retry. Ordinary realtime transport,
server quotas, pending guards, command validation and engine rules are unchanged.
Unit regressions cover overlapping poll/move, queue bounds, failure recovery,
disconnect and unchanged ordinary concurrency. The production-bundle browser
fixture enforces the real single-pending guard and holds a poll while the user
submits a table command in Chromium and WebKit.

The display font is the supplied `HamBaziDisplay-Regular.ttf`, family `HamBazi
Display`, Regular 400, with Arabic/Persian glyphs and GSUB/GPOS shaping tables.
Its SHA-256 is `546c858e8c39315c409281c9ef7ab9e2d9225b37b3aedf0659776d5ac8239e2b`.
Headings, tile labels, entry buttons and wordmark use it; tutorial prose and
existing gameplay use readable system fonts. TTF and WebP assets are self-hosted;
SVG ornaments/icons and text are live code. See [asset provenance](../design/midnight-assets.md).

The new production-bundle browser suite uses the unmodified integrity-pinned
official Telegram SDK and synthetic engine golden PlayerViews. Its HTTPS origins
are intercepted to local servers; it never signs in to staging. Both Chromium
and WebKit cover static navigation, required registration, duplicate start,
ambiguous retry, existing-game resume/reconnect, terminal UI, existing settings,
320/375/390 widths, safe areas, RTL, accessibility, font loading/failure, keyboard
input and enlarged text. Fixture terminal transitions prove UI wiring only.

Read the manifests before using these declared scripts/entry points:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@hambazi/contracts
VITE_API_ORIGIN=https://api-staging.hambazi.top HAMBAZI_WEB_ORIGIN=https://staging.hambazi.top pnpm --filter @hambazi/web build
pnpm --filter @hambazi/web test:midnight
pnpm --filter @hambazi/web test:browser
pnpm test:personal-http:local
pnpm check
```

Browser WebKit is not an iPhone Telegram WebView. The owner reported that the
Midnight screens and navigation worked, with intermittent gameplay “many requests”
errors. After the transport correction, the user reported a successful focused
retest with «اوکیه». Account, per-step results, client version/model were not
separately supplied; see the [operation report](../operations/midnight-personal-lobby.md)
for durable metadata and the retained full-game evidence limits. Prior Bot
onboarding/support acceptance remains separate. This implementation does not
resolve public launch, final asset rights or other open architectural decisions.

# Midnight personal lobby and Coup entry

The registered `owner-auth` session lands on `/games`. Unregistered sessions on
every route retain the existing Persian registration gate and return-to-Bot
action; navigation never creates or completes a profile. Admission remains the
server's verified numeric-ID policy, not a frontend username check.

| Route                  | Screen                               | Entry side effects                                                           |
| ---------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| `/games`               | Coup active, Hokm/Ludo coming soon   | None                                                                         |
| `/games/coup`          | Artwork, tutorial and start controls | None                                                                         |
| `/games/coup/tutorial` | Current five-role tutorial           | None                                                                         |
| `/settings`            | Existing profile preferences editor  | Own profile read; explicit patch only                                        |
| `/games/coup/play`     | Existing personal game/table         | Personal connection/current lookup; creation only with explicit start intent |

Native BackButton and visible back share the same destination: tutorial/play to
entry, entry/settings to lobby. Leaving the table clears its UI timer but never
sends personal close. The existing runtime owns reconnect and memory-only auth;
no token, initData, hidden state, chat content or profile is logged or stored for
UI diagnostics. The legacy personal `/match/<uuid>` route uses the current own
match, never a URL-supplied identity.

Start guards rapid taps before hash navigation. A failed current lookup cannot
fall through to creation. Network retry uses the original command ID; a committed
but ambiguously acknowledged start resumes the current durable match. The server
remains authoritative for commands, deadlines, snapshots and active-match
uniqueness. Gameplay layout and server rules are unchanged.

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
pnpm --filter @hambazi/web exec playwright test --config midnight.playwright.config.ts
pnpm --filter @hambazi/web test:browser
pnpm test:personal-http:local
pnpm check
```

Browser WebKit is not an iPhone Telegram WebView. New native visual/functional
acceptance stays pending until the owner tests the deployed build. Prior Bot
onboarding/support acceptance remains separate. This implementation does not
resolve public launch, final asset rights or other open architectural decisions.

# Telegram Mini App shell — Phase 14A

## Local execution

`pnpm --filter @hambazi/web dev` starts Vite on loopback. Configure public
`VITE_API_ORIGIN` from `apps/web/.env.example`, or omit it for same-origin API
routing. HTTPS is required except explicit loopback development. The API must
allow the web origin. `pnpm --filter @hambazi/web build` emits module declarations
and a static browser bundle in `apps/web/dist/client`. `preview` serves that bundle.
No deployment, Bot setting or production runtime is enabled by these commands.

For an isolated browser preview without Telegram or a running API, run
`pnpm --filter @hambazi/web dev:preview` and open `http://127.0.0.1:4173`.
The command starts the existing synthetic browser-test HTTP/Socket fixture on
`127.0.0.1:4174` and a separate Vite development configuration on loopback.
Its mock Telegram bridge supplies a visibly labelled preview identity; the
fixture issues a synthetic session so the catalog, profile, lobby and shared
platform flows can be explored. Preview data is disposable and does not
represent a real Telegram account or active production game. The test fixture
has control endpoints for browser tests; preview mode disables them. Keep this
command local. Stop it to stop both
servers. `pnpm --filter @hambazi/web test:preview` checks this entry path in
Chromium.

To inspect Coup directly, open `http://127.0.0.1:4173/#/preview/coup` after
starting `dev:preview`, or use the **Open Coup table** link in its banner. This
route creates the synthetic fixture session automatically and opens the Coup
Match screen without catalog, lobby, room or matchmaking steps. The table uses
checked-in golden public PlayerView data from the disposable fixture. Its
command acknowledgements are synthetic UI wiring, not engine gameplay. The
route requires the preview-only HTML marker and Vite development mode. The
ordinary app leaves that route inert, and the production build rejects the
route marker and preview data in its output.

The normal `dev` command and production build use the official Telegram bridge.
The preview-only Vite config rejects build/production mode, injects the mock
bridge only into its local development HTML, and never changes backend Telegram
signature verification. Real API authentication still requires valid Telegram
`initData`; the preview command forces requests to its separate loopback
fixture. Preview mode disables the fixture's test-control endpoints and requires
its synthetic credential for mock protected routes and sockets. The production
build checks that the guarded, integrity-pinned official bridge remains, no
parser-loaded SDK bypasses the guard, and preview markers are absent from its
browser output.

The repository's configured API can provide auth/profile/catalog/optional room
REST. Socket and matchmaking composition remain opt-in. The production catalog
remains non-playable, so an ordinary runtime correctly displays disabled lobby
actions. Private-room-to-Match orchestration, production matcher scheduling and
Phase 7C activation are still backend integration/activation gates. The shell
does not pretend STARTING means a committed Match exists.

## Ownership and security

React/Vite and Tailwind provide the browser shell; each existing frontend feature
owns its screens behind its public index. Platform clients own transport and safe
error mapping. TanStack Query owns fetched server state; a non-persisted Zustand
store owns session metadata, connection status, invitation routing, search ticket
and the latest server-projected Match snapshot. No engine is imported by Web.

The official Telegram bridge supplies raw initData. Under
[ADR-037](../adr/037-telegram-bootstrap-privacy.md), HamBazi first removes accessible
legacy `__telegram__initParams` caches and protects that exact key against SDK
reads/writes before loading the official HTTPS script. The script has a reviewed
SHA-384 integrity pin, anonymous CORS, no referrer and a ten-second loading
deadline. Failed cleanup/protection/loading/integrity grants no launch credential;
bootstrap cannot fall back to a rejected global bridge. Changes to official SDK
bytes require storage review, a pin update and passing real-SDK browser gates.
ready/expand, BackButton,
viewport/theme and safe-area changes follow the [Telegram Mini Apps API](https://core.telegram.org/bots/webapps).
SDK launch parameters are removed from URL/history after bootstrap. Unverified
start_param is only an opaque routing hint and never identity or membership.
Account creation is explicit; its server-returned routing hint survives login.
Backend verification, identity and authorization remain authoritative.

Access tokens live in a private runtime closure; initData and admission credentials
stay in memory. Credentials never enter localStorage/sessionStorage; the official
SDK may store non-sensitive theme settings under its unrelated key. No credential
persistence middleware, analytics, query devtools, service worker, raw error
logging or full-state rendering is added.
HTTP uses bearer headers, omitted cookies, no-store, redirect rejection, response
bounds and deadlines. Receiver schemas accept additive fields and strip unknowns.
Errors display fixed text keyed by stable codes, never server/debug messages.

Expiry, logout and disposal close sockets and clear Query/session state. Late
HTTP and Socket results are fenced. A fresh Telegram launch is required after
expiry; no refresh mechanism or seat reclaim is introduced. Logout always drops
local credentials; if its request fails, server revocation is not guaranteed and
the short-lived server session still expires normally. Full page reload drops
in-memory credentials and ticket/room navigation context; SDK launch-cache
restoration is blocked and accessible legacy copies are physically deleted.
The SDK may retain its initData getter in document memory until page closure;
HamBazi drops its own credential reference on logout/disposal.
No backend active-ticket discovery API
is invented. Hash routes retain room/match IDs, never invitation capabilities or
authentication credentials. Reloaded users re-authenticate before those routes.

## Transport behavior

- Lobby modes come only from catalog metadata under ADR-028. Absence means no
  selectable mode. Playability/status/capabilities gate presentation; the backend
  independently checks all admission rules.
- Room create/read/share/resolve use REST. Join/leave/start use Socket. Read-only
  room snapshots poll every ten seconds while visible; search status polls every
  five seconds, stopping on error/terminal result. These are UI refresh intervals,
  not server rate/timeout defaults. Reserved room/matchmaking push names are not
  assumed to deliver events. Rate errors surface a manual retry.
- A mutation captures its input and UUID once. Ambiguous failures retain that
  exact operation for explicit retry; double clicks cannot allocate another ID.
  Conflict errors require refreshing current server state before a new intent.
  Cancel returning MATCHED is rendered as a committed match, never cancelled.
- Socket uses the versioned path/namespace and both default transports. No offline
  command buffering. Reconnect re-subscribes and resynchronizes. Switching Match
  subscriptions recreates the connection because the current gateway has no
  unsubscribe command; leaving the game screen alone does not drop its live seat.
- Shared sequence handling rejects stale/duplicate snapshots and requests catch-up
  on invalidations/gaps. Snapshot acknowledgements use lastEventSeq. Disconnect
  discards the old view; a returning spectator cannot keep a cached player view.
  Role changes and server status drive the shared session screen. Phase 14B adds
  the Coup player/spectator projection and controls described in
  [Coup Mini App UI](coup-mini-app-ui.md).

## UI and validation

The shell supplies loading/error/disabled/reconnect/expiry states, labelled controls,
keyboard focus, a working skip link, Telegram back navigation, safe-area spacing,
light/dark appearance and small-screen/text-enlargement reflow. Player-provided names
are plain React text with bidi-aware inputs. Profile stores the already-approved
language preference; screen copy is currently English (translations are not claimed).
Room roster contracts expose IDs/seats, not names, so UI shows You/Player N/Host
without inventing profile reads or leaking identifiers into visible names.

`pnpm --filter @hambazi/web test` covers transport parsing, bounds, memory lifetime,
late-result fencing, mode discovery, sequence and reconnect behavior.
`pnpm --filter @hambazi/web test:browser` starts disposable loopback HTTP/Socket
fixtures plus Vite and runs Chromium flows, axe accessibility and viewport checks.
The synthetic fixture also serves the local preview; its playable catalog and
mock bridge never enter the production bundle.
This is component/contract-client browser evidence, not live Telegram or durable
PostgreSQL gameplay E2E. Screenshots are generated under ignored test-results.

The ordinary browser suite includes unmodified, hash-verified official SDK tests
with synthetic launch credentials. A bare-SDK negative control detects the original
storage defect; native writer probes and original storage reads verify prevention,
legacy deletion, reload, successful/failed logout and safe bootstrap failure.
`pnpm --filter @hambazi/web test:browser --config telegram-production.playwright.config.ts`
runs the same privacy cases against a built production bundle and disposable fixture.
These tests fetch the public SDK or accept `TELEGRAM_SDK_FIXTURE_PATH` pointing to
reviewed offline bytes; either path must match the production integrity pin.
No SDK fixture is vendored into the app. The production browser configuration
sets a synthetic loopback API destination during its build; run the normal Web
`build` afterward to restore output for the configured ordinary destination.

Phase 17A3 now generates and verifies `dist/client/security-headers.json` and
enforces its restrictive CSP/security headers in ordinary built-output preview;
see [browser policy](../security/browser-policy.md) and ADR-038. Browser validation
uses Zod interpreted mode before schema imports, so inline/eval scripts stay
denied. Explicit approved HTTPS/WSS/frame origins remain deployment inputs; the
default artifact selects no production domain and denies framing. The production
browser suite also checks real SDK compatibility, HTTP/WS transport and actual
browser resource/framing denials under this policy. Static hosting must apply
the generated response headers with known-origin API CORS and HTTPS/WSS at the
approved edge. Telegram client compatibility, live HTTPS smoke, actual mobile
WebViews and production admission remain unverified.

Phase 15A adds [Match chat](match-chat.md) through the Chat feature's public index.
It uses separate memory/cursors from game synchronization, bounded plain-text
history, stable ambiguous-send retries and server-derived send permissions. It
clears on Match switch/logout and refreshes after reconnect; Bot-replaced humans
remain read-only. Production Chat activation and final retention/moderation/age
policy remain separate gates.

# Mini App browser policy — Phase 17A3

[ADR-038](../adr/038-mini-app-browser-policy.md) owns this local policy.
`apps/web/security/browser-policy.ts` is the pure generator; the Vite plugin
emits the public deployment artifact and verifies/enforces it in ordinary preview.
This is not a provider deployment or live Telegram compatibility approval.

## Inputs and execution

Use the declared `pnpm --filter @hambazi/web build` and `preview` commands. Vite
loads these inputs from the existing environment/mode mechanism:

| Input                         | Meaning / default                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_ORIGIN`             | Existing public REST/Socket origin. Omitted means runtime same-origin routing. Production requires an exact HTTPS origin.                   |
| `HAMBAZI_WEB_ORIGIN`          | Exact approved HTTPS Mini App origin, including any non-default port. Adds explicit HTTPS/WSS self destinations. Omitted selects no domain. |
| `HAMBAZI_WEB_FRAME_ANCESTORS` | JSON array of exact approved HTTPS framing origins. Default `[]` denies all framing; no wildcard, path or implicit self permission.         |
| `HAMBAZI_WEB_POLICY_PROFILE`  | Default `production`. Explicit `loopback-test` requires loopback Web/API origins and a loopback preview bind; never deploy this profile.    |

Reject credentials, paths/trailing slashes, queries/fragments, noncanonical
origins, wildcards, directive injection, duplicates and unbounded ancestor lists.
The SDK hash comes only from `src/platform/telegram-sdk.ts`, never configuration.
The artifact contains only public inputs and headers; no dotenv contents, API
credentials, user data or server secrets. `VITE_*` is public build configuration
and must never receive a secret. Provide the approved Web origin even for
same-origin API deployment so explicit WSS permission is reproducible.
The Web Turbo build explicitly hashes/passes all four public inputs and hashes
Web-local `.env*` files. No root runtime secret file is added to browser inputs.

No final domains are supplied here. Native Telegram clients need no framing
permission; Telegram Web's actual embedding origins must be inventoried and
explicitly approved. Browser tests use `https://web.telegram.org` as a synthetic
parent, not a complete production origin list. Frame ancestors govern embedding;
they are not API CORS origins. Configure the API's existing `ALLOWED_ORIGINS`
with the Mini App origin(s), preserving its production HTTPS/trusted-peer checks
and known-origin REST/Engine.IO enforcement. Never reflect Origin or add Telegram
ancestor origins to CORS merely because they frame the app.

## Header and privacy boundary

`security-headers.json` has a version, profile, public origins and exact header
map. Preview and production boundary checks regenerate and compare it against
the current pin; malformed inputs, inconsistent headers and stale SDK pins fail
closed with a fixed error that does not echo artifact contents. This does not
authenticate an artifact or authorize self-consistent changes to its origin
inputs: approved inventory and immutable release provenance remain external
gates. The eventual static edge
must apply all headers to HTML, SPA fallback and error responses. Verify actual
responses after deployment, not just the checked-in generator or JSON asset.
Do not substitute a CSP meta tag for frame-ancestors. Mini App HTML must not
inherit an API `X-Frame-Options: DENY` header that contradicts approved framing.

The policy denies inline/eval JavaScript and script attributes, unlisted network
destinations, remote image/font/style loads, child frames, workers, objects,
forms and base elements. Exact HTTP(S) and derived WS(S) origins support polling
and upgrades. SDK SRI, anonymous CORS and no-referrer remain mandatory. Browser
validation sets `z.config({ jitless: true })` before contract/schema imports;
there is no eval-dependent browser schema compilation.

Inline CSS permits the official SDK's theme and parent styling; text rendering
and server validation remain authoritative. Camera/microphone/geolocation/
payment/USB are disabled. No CSP report-uri/report-to/report-sample, session
replay or raw browser error exporter is configured: launch URLs, snippets and
private payloads must not be sent to a collector. Production HSTS covers this
host only; owner-approved TLS, subdomain and preload decisions remain external.
No-store applies consistently in preview. Production static delivery follows
[ADR-077](../adr/077-public-static-asset-delivery.md): only public image/font/JS/CSS
build assets under `/assets/` may be cached. Hash-named assets are immutable;
mutable asset names require ETag revalidation. HTML, JSON, SDK, errors, health and
authenticated responses retain no-store. Other generated security headers remain
unchanged. Compression negotiation and validators must survive static ingress.

The edge must omit credential-bearing query strings/request bodies and sensitive
headers from access/error logs; URL cleanup in browser code cannot erase an
already received HTTP query. Fragment launch data stays client-side but still
must never enter client telemetry. SDK cache protection, physical legacy cleanup,
clean reload and memory-only auth are documented in ADR-037. Auth remains
server-verified; CSP does not turn synthetic or unsafe launch data into identity.

## Verification and release limits

`pnpm --filter @hambazi/web test` covers generation, origin validation and artifact
tampering. With reviewed SDK bytes supplied through `TELEGRAM_SDK_FIXTURE_PATH`,
the existing `test:browser --config telegram-production.playwright.config.ts`
builds and serves the actual app under an enforced loopback policy. It covers
real-SDK privacy, sign-in, polling/upgrade, response/fallback/error headers,
inline/eval and resource denials, allowed/denied ancestor framing and real SDK
parent CSS/theme messages. HTTPS parent/child framing tests route the built
responses into synthetic HTTPS origins to exercise browser frame enforcement;
they do not verify a real certificate, provider or Telegram account.

Run normal Web `build` after this suite to restore the ordinary production
artifact without loopback fixture destinations. Keep SDK pin updates coupled to
real-SDK privacy and CSP gates. Ordinary development and synthetic preview
regressions still run through their declared commands. Public HTTPS/staging,
mobile WebView/Telegram Web variants, edge caching/log redaction and sticky
polling ingress remain OD-002/18B evidence, with no live activation in 17A3.

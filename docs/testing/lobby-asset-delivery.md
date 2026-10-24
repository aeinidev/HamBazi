# Lobby asset delivery verification — 2026-10-23

Implementation: [ADR-077](../adr/077-public-static-asset-delivery.md).
These results describe the local candidate. No live image, ingress configuration,
security binding or deployment inventory was changed by this task.

## Findings and transfer sizes

Read-only HTTPS checks of staging confirmed `Cache-Control: no-store` on the
2,654,247-byte Kahroba hero and the 553,489-byte application bundle. The bundle
was uncompressed despite `Accept-Encoding: br, gzip`. Static ingress explicitly
discarded those negotiation headers.

| Public artwork                              | Original bytes | Candidate bytes | Reduction |
| ------------------------------------------- | -------------: | --------------: | --------: |
| Seven main-lobby images, compact candidates |        742,792 |         258,480 |     65.2% |
| Kahroba palace and transparent hero         |      5,524,765 |         702,084 |     87.3% |

Main-lobby srcsets retain the original images for larger effective resolutions;
the compact total applies when those candidates are selected. Actual first-load
latency depends on device, connection and server. No simulated speed multiplier
or live latency improvement is claimed.

The real production static adapter successfully served the built public bundle
using Brotli/gzip with identical decoded bytes and immutable asset headers. A
representative staging-origin build transferred its 554,142-byte JS bundle as
154,078 bytes with Brotli or 164,444 bytes with gzip. Its 66,938-byte stylesheet
compresses similarly. Final build hashes/sizes depend on public build flags.

Actual Chromium and WebKit probes used the production static adapter and normal
browser HTTP caches, without request interception or a service worker. On a
fresh page the 353,228-byte hero decoded successfully; the resource timing
transfer was 353,528 bytes including overhead. A second document navigation
decoded the same image with **zero transferred bytes** in both engines.

## Checks

- Web unit suite: 124 passed.
- Infrastructure suite, excluding ignored historical candidate checkouts:
  174 passed, 2 skipped. Includes real static HTTP compression/HEAD/304 behavior,
  no-store documents/errors/health, ingress allowlists, asset hashes and budgets.
- Kahroba lobby presentation: six passed across Chromium/WebKit at 320/390/768px,
  including actual decode of the optimized hero and CSS background and existing
  accessibility/layout assertions.
- Main lobby presentation: six passed across Chromium/WebKit at 320/375/390px,
  including selected compact image URLs, actual image decode, accessibility,
  startup shell and layout assertions.
- Web typecheck, production build, scoped ESLint, formatting, architecture and
  diff whitespace checks passed.

The first broad infra invocation also collected an ignored historical checkout
under `test-results/coup-disable-finalization/candidate`; its private deployment
test failed. The current repository infra inventory passed after explicitly
excluding `test-results/**`. The first main-lobby invocation used a build without
its required staging API origin and failed sign-in. After rebuilding with the
fixture origins, Chromium exposed reuse of the large Coup poster loaded by the
pre-auth shell. Switching that blurred background to the compact image fixed the
extra download; the final two-engine presentation run passed.

## Reproduction and activation

Use the repository's declared scripts, with existing dependencies installed:

```sh
pnpm --filter @hambazi/web typecheck
pnpm --filter @hambazi/web test
pnpm test:infra --exclude 'test-results/**'
pnpm --filter @hambazi/web test:kahroba --grep 'approved home composition'
VITE_API_ORIGIN=https://api-staging.hambazi.top VITE_KAHROBA_RUNTIME=true HAMBAZI_WEB_ORIGIN=https://staging.hambazi.top HAMBAZI_WEB_FRAME_ANCESTORS='["https://web.telegram.org"]' pnpm --filter @hambazi/web build
pnpm --filter @hambazi/web test:midnight --grep 'branded boot and authenticated home'
```

Untracked local transfer/cache evidence is under
`test-results/lobby-delivery-performance/`; presentation screenshots are in the
existing browser-test output directories. No dependencies changed, so no install
was required. Database/gameplay integration, full create-to-finish E2E, network
load/soak and live deployment checks were not run for this static-delivery change.

Activation requires a newly qualified Web image containing both the built client
and changed `server/serve.mjs`, plus the reviewed static ingress header allowlist.
Uploading only the artwork or only the client build does not activate server
compression/cache behavior. Follow the current server release/security binding
and rollback runbook; preserve API/Worker/Bot and durable data. Validate nginx
before reload, then verify actual HTTPS Content-Encoding/Cache-Control/ETag/304,
fresh HTML, WSS and decoded main/Kahroba art in both browser engines. Do not claim
the live issue resolved until those activation checks pass.

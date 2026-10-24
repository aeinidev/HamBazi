# Restored home and compact Web deployment — 2026-10-23

The owner requested retaining the original main-lobby presentation and publishing
all other completed Web changes. The release is live at
<https://staging.hambazi.top/> on the existing replacement server **89.46.217.9**.
Activation completed at `2026-10-23T13:47:07.923700+00:00` (17:17 Tehran).

The main lobby keeps its prior banner/card aspect ratios, centered 650px shell,
header/avatar sizes and fixed bottom navigation. Image transfer optimization is
retained. Settings/profile, Coup entry/tutorial and Kahroba lobby/room/table views
keep the compact viewport presentation. Long tutorials and choices are paginated;
Kahroba market and resources are selectable views. See the
[layout record](../design/viewport-layout.md) and [ADR-077](../adr/077-public-static-asset-delivery.md).

## Immutable artifact and activation

- Web source snapshot commit: `edd866e6656e5b25637a2b931a31e50146abb3b2`.
- Source archive SHA-256: `1da82312d228782fb071937e06f2b91ffe7dc0979b9fa87fd8393b6b7eba27e3`.
- Build input SHA-256: `b6c2f87a9441ee1cd68f7a8ecf50f39818a1c348c3c2125487ff973e27ed668a`.
- Web image: `hambazi-compact/web:20261023-b6c2f87a9441ee1c@sha256:5c407358bb48c20ad1304fc214afba89ea09cae3a5d973606970ecb36c4b9014`.
- Static ingress SHA-256: `454d7262e99acc9bf3171339d3d4df191f158054ce410866476e166369161043`.

The isolated source snapshot retains the owner's uncommitted changes without
moving the working branch or staging index. Its offline frozen install passed
using the existing lockfile and pnpm 12.4.1; the uncached repository Web build and
its dependency builds passed on Node 24.20.0. The payload contains an exact hash
inventory of 50 public client files and a separately hashed static server. Public
payload secret scanning reported zero findings.

The Web image derives from the previously qualified exact Web image and replaces
only the built client and static adapter, retaining the signed Alpine musl fixes
and hardened runtime. A read-only, capability-dropped, network-isolated image
probe verified root no-store, Brotli asset delivery, immutable asset headers,
ETag/304, private readiness and path isolation. Fresh exact-image scans passed
for all six active role pins; the previous Web image was separately scanned for
rollback. No High/Critical/Unknown findings were accepted. Permitted Moderate/Low
findings remain subject to the existing policy.

The nginx change adds only Accept-Encoding and If-None-Match forwarding to the
existing static route. The candidate matches the tracked ingress and was tested
against the active top-level nginx configuration before maintenance. All other
routes and request-header allowlists remain unchanged.

Cutover confirmed no active Match, used the existing maintenance/drain procedure,
created a private custom-format PostgreSQL archive and verified its listing.
Only Web was recreated. API, Worker, Bot, PostgreSQL and Redis retain their exact
image/container identities; existing admission, credentials, database volume,
users, match records and 15 migrations were preserved. No migration or Telegram
configuration change was made. The archive was verified, not restore-rehearsed or
copied to an offsite backup.

Four strict private READY checks and the full bound security verifier passed
before reopening nginx. Reviewed Web/container and changed Compose/ingress file
bindings were updated from actual deployment evidence; all other bindings were
preserved. Both the hourly renewal timer and independent expiry timer are active.
The observed finite deadline is `2026-10-24T13:13:41Z`; consult server state for
later renewals. No rollback was required.

## Verification

- Web types, scoped lint, formatting and build passed; 124 Web unit tests and
  174 current-directory infrastructure tests passed (two environment skips).
- Eighteen focused Chromium/WebKit cases passed for the restored main layout,
  compact remaining pages, native insets/navigation and image delivery. Earlier
  compact presentation coverage includes 208 distinct browser cases.
- Actual HTTPS Chromium and WebKit checks passed before and after deployment.
  Every measured main-lobby shell/banner/card/nav/avatar rectangle matched its
  predeployment baseline at 390×844, with a 0.1px comparison tolerance.
- Both deployed browsers verified compact settings, Kahroba entry/create/settings/
  help views, decoded optimized hero/background art, capacities 2/3/4, authenticated
  Kahroba WebSocket connection, clean launch URLs, zero credential storage and zero
  fatal page errors. Checks created no live room or game and sent no messages.
- Real HTTPS bundles use Brotli, immutable public-asset cache headers and working
  conditional 304 responses. The deployed JS transfer is **154,531 bytes**;
  CSS transfer is **17,589 bytes**. HTML remains no-store and
  unauthenticated profile access remains 401.

Current pins and per-role sources are in
[deployment.json](../../infra/docker/server/deployment.json) and
[compose.yaml](../../infra/docker/server/compose.yaml). Postdeployment operational
records are separate from the immutable application source snapshot above.

Private build, qualification, old controls, rollback material and the database
archive remain under `/opt/hambazi/releases/compact-20261023` on the server. Local
private evidence is under `/home/mehdi/.cache/hambazi-compact-release-20261023`;
screenshots are in ignored `test-results/compact-release-20261023`.
Native Telegram device acceptance, full DB-backed create-to-finish E2E, load/soak
and backup restore are not claimed by this Web release.

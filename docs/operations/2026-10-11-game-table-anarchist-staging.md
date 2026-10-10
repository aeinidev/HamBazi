# Coup table and shared Anarchist — restricted staging

Runtime source is clean `4b154f1e6437aa4908752a1e6b7e080ba83c5448`.
The four exact API/Bot/Worker/Web images are healthy. Restricted traffic opened
at `2026-10-10T20:13:44.705Z` (23:43:44 Tehran). The
[current binding](../../infra/docker/staging/staging-test-user-current.json)
records immutable image, preparation, configuration and private evidence hashes.
Public/production release remains HOLD. Native table acceptance remains pending.

## Delivered behavior

The supplied gameplay Markdown determines the table structure; the owner's
later messages determine automatic truthful Contessa defense, two-second public
animation/exchange and the non-refundable five-coin payment. The five latest
supplied JPEG portraits and HamBazi Display font are byte-identical local assets.
Their [provenance](../../apps/web/public/assets/coup/provenance.json) records hashes.
Restrained cyan/violet framing is rendered in code, preserving the portraits.
The table uses real responsive components, dynamic public names/seats/coins,
private local influence cards, role-detail dialogs, authoritative deadlines,
legal target confirmation and a secondary drawer for all existing actions.

New personal matches pin `coup-anarchist-v1`, state schema 5, ruleset
`coup-anarchist-v1`, command/event schemas 4 and view schema 2. Shared Anarchist
is never dealt. Genuine live Contessa defends automatically; the replacement
commits atomically and the UI reveals it after the public animation. Payment,
influence loss and replay use the existing idempotent version-checked writer.
Both API and Worker retain the old engine for old pinned matches; active states
are not upgraded. See [ADR-061](../adr/061-shared-anarchist-and-retained-personal-pins.md).

Owner identity, one verified numeric ordinary tester, required registration,
original-owner support destination, text-only `/start`, native descriptions,
request sequencing, rate quotas, fullscreen launch, vertical-swipe behavior,
safe areas and navigation remain unchanged. No operator registration,
administrator grant, migration or backfill ran. Existing 15 migrations/grants
were verified. All 152 pre-existing files under `docs/` and all 124 pre-existing
tracked Markdown files retain their original bytes against `fe6009a`. Supplied
implementation documents remain unmodified.

## Validation and verified packaging correction

Full `pnpm check` passed, including formatting, lint, boundaries, typechecking,
unit tests, build and contract checks. Focused coverage includes 91 engine tests,
86 Web unit tests, 68 Midnight Chromium/WebKit cases, 28 existing browser cases,
the isolated PostgreSQL/Redis personal HTTP/Socket/BullMQ/restart harness,
44 actual packaged runtime checks and two packaged browser cases. An additional
test-only closeout strengthens eliminated-target rejection; the engine suite,
typecheck and focused lint passed again. Secret/history and dependency scans pass.

The initial `a60f10e` candidate failed packaged Web startup because JPEG was
missing from the server's static MIME inventory. It was rejected before traffic.
`4b154f1` adds the JPEG MIME entries and an inventory regression check. All four
images were rebuilt from that clean source and passed packaged checks.
Locked registry download timeouts required host networking for image builds only;
runtime network and security policy remain unchanged.

Delivered staging HTML/JS/CSS/SDK/font/role portraits match packaged bytes.
Chromium uses direct HTTPS; Linux WebKit uses a TLS-verified HTTP adapter.
Synthetic registered-session/public-view fixtures exercise lobby framing,
navigation, table layout, actual image/font loading, role details, safe areas and
one-shot fullscreen dispatch without retry after exit. No real account/game
mutation runs in these checks. They establish browser behavior, not native
Telegram authentication or iPhone acceptance. Compiled API/Bot admission checks
admit the owner and numeric tester and deny an unrelated identity. Public admin,
internal, private-health and ordinary catalog routes remain closed.

## Scan-expiry containment and normal renewal

The previous scan deadline expired at `2026-10-10T19:06:47Z` (22:36:47 Tehran)
during build/preparation. The existing containment service correctly activated
maintenance and gracefully stopped all four old roles with exit zero. It was
never disabled, bypassed or given a freshness exception.

Direct scanner database download attempts timed out. The exact official
`mirror.gcr.io/aquasec/trivy-db:2` manifest/layer was downloaded and digest-verified;
a private loopback OCI cache supplied those unchanged bytes to the same pinned
scanner's normal `--download-db-only` operation. The scanner wrote its own
DownloadedAt; publisher UpdatedAt/NextUpdate were preserved. No metadata date
was fabricated. Database UpdatedAt is `2026-10-10T12:33:35.352381306Z` and
DownloadedAt is `2026-10-10T19:17:49.240995842Z`.

All eight exact application/component/data images pass fresh normal scans.
The unchanged containment service remains enabled; only its normal timer
deadline was renewed from those valid scans, to `2026-10-11T12:33:35Z`
(11 October, 16:03:35 Tehran). A further normal scan renewal is required before
that deadline; otherwise containment will close service as designed. Startup
health and restricted routes were verified before reopening traffic.

Capacity recovery removed only exact unreferenced historical `395c6e7` and
`55a4b19` image caches and the rejected `a60f10e` candidate, after verifying
recoverable local image archives. Only incomplete files in the new private
scanner cache were removed after a failed download exhausted disk space.
Existing valid scan cache, PostgreSQL/Redis volumes, secrets, current images,
selected previous `8a3d319` artifacts and containment were preserved. All four
candidate layers were materialized with never-started probes, then probes were
removed; free disk was 1,148,067,840 bytes at the final capacity check. No global
Docker pruning or database deletion ran.

## Rollback limit and native retest

The previous `8a3d319` artifacts/preparation are retained, but they do not support
the new v2 engine/state pins. No rollback drill or arbitrary-version rollback
acceptance is claimed. Once v2 state/jobs exist, draining active games alone
does not establish rollback compatibility: retained reads/jobs must also remain
supported. A repair must retain both adapters or use a newly validated compatible
artifact, following the existing rollback runbook; never rewrite or discard v2
state to run the old artifact.

On an admitted registered iPhone account in `@Hambazidev_bot`, fully close the
Mini App and reopen Open, then choose Coup and start a **new** personal game.
An old pinned game keeps its old rules. Check the supplied card portraits/font,
role details, all actions, seat placement, deadlines and unobstructed controls.
On your legal turn, check muted/locked Anarchist below five coins, target
confirmation at five/seven and mandatory Coup at ten. Execute Anarchist and
confirm the five-coin payment is not refunded; if a genuine Contessa defense
occurs, confirm its two-second animation/exchange, otherwise influence loss.
Finish a game, return/reopen and check unfinished-game resume without duplicate
effects or request errors. Report iPhone model and Telegram version with the
result. Native acceptance remains pending until that real-device test succeeds.

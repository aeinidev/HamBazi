# Local release correctness suites

Phase 17B exercises public application ports, real PostgreSQL transactions, Redis
coordination, BullMQ delivery and Chromium. Production activation, HTTPS/Telegram
WebView acceptance and Phase 17C capacity/soak measurements remain separate.

Phase 18A's [CI runner](../operations/ci.md) invokes these suites sequentially
with pinned real local service images and an isolated restore drill. It captures
only scalar results and restores the normal Web policy before evidence. The
owner originally deferred 17C until production-like staging was available, then
resumed local tooling. On 2026-10-07 [ADR-048](../adr/048-mvp-capacity-acceptance.md)
accepted MVP completion with documented performance exceptions and mandatory
correctness/security gates. Approved capacity/normal SLO targets remain future
optimization/staging targets; final operating policy and staging evidence are open.
These local suites do not authorize release or complete staging acceptance.

## Commands and isolation

Use the declared scripts with Node/pnpm versions pinned in the root manifest:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @hambazi/api contract:generate
pnpm --filter @hambazi/api contract:check
```

`pnpm check` includes formatting, lint, architecture boundaries, type checks,
unit/domain and infrastructure tests, builds and contract checks. Provision the
reviewed scanner binaries and set `SECURITY_SCANNER_DIR` to include the optional
real Gitleaks canary; otherwise that test is explicitly skipped.

Provision compatible PostgreSQL binaries, then run the existing disposable HTTP
integration harness:

```sh
TEST_RELEASE_BROWSER=isolated \
TEST_POSTGRES_BIN=/absolute/path/to/postgresql/bin \
TEST_POSTGRES_SHARE=/absolute/path/to/postgresql/share \
pnpm test:auth-http:local
```

Set `LD_LIBRARY_PATH` if the binaries require it. Docker must be available for
the pinned disposable Redis image. The harness creates its own loopback
PostgreSQL cluster, private credentials, separate API/Worker roles and Redis ACL
users; migrates/redeploys the schema; verifies upgrade and restart persistence;
runs database/API/Worker integration suites; and invokes Web `test:browser`
with `release.playwright.config.ts`. Without `TEST_RELEASE_BROWSER=isolated`,
the command retains integration-only behavior. No existing `.env`, database,
volume or Telegram account is used. Browser cases use a separate freshly migrated
database in that same owned cluster, isolated from earlier fault/quarantine data.
Cleanup removes only owned resources.

The release config builds and serves the actual Mini App artifact with an
explicit loopback test browser policy, alongside compiled API/Worker components.
It sets `NODE_ENV=production` for this build rather than inheriting the disposable
cluster's development environment. It does not select a public hosting origin.
Restore a normal Web build afterward.

Chromium must already be installed for the lockfile-pinned Playwright version.
Keep loopback ports 4173, 4174 and 4176 free; existing servers are never reused.
Do not invoke the fixture against an independently supplied database: startup
requires harness guards and matching loopback database endpoints.

Additional declared Web gates remain independent:

```sh
pnpm --filter @hambazi/web test:browser
pnpm --filter @hambazi/web test:browser --config telegram-production.playwright.config.ts
pnpm --filter @hambazi/web test:preview
pnpm --filter @hambazi/web build
```

The first two retain the synthetic platform fixture and official SDK privacy
tests. Provision `TELEGRAM_SDK_FIXTURE_PATH` with integrity-pinned official bytes
when retrieval is unavailable. Preview checks the development-only entry point.
The final normal build restores ordinary production policy after the explicit
loopback built-app check.

## Coverage

| Guarantee                                                       | Executable evidence                                                                                                                                                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generated contracts match; breaking security/event changes fail | API `release-contract.test.mjs`: actual CLI check/write/recheck in disposable copies; modified baselines and stale artifacts rejected without changing real baselines                                          |
| Unknown-commit commands have one effect                         | API `match-processing.test.ts`: six real commit acknowledgement losses, eight concurrent original-intent retries each, receipt/event/outbox reconciliation                                                     |
| Database failure preserves unaccepted intent                    | Processing suite: disconnected adapter fails; fresh writer retries the same ID once                                                                                                                            |
| Cancel versus Match has one durable winner                      | Existing matchmaking suite: twelve Redis/PostgreSQL races, reservation expiry and queue failure                                                                                                                |
| Reconnect versus timeout has one owner                          | Existing reconnect suite: twelve independent-client races, epoch/version fences, process restart and takeover                                                                                                  |
| Private start is recoverable and authorized                     | Private-room suite: frozen roster, competing starts, lost acknowledgements, reconstruction, version pins, explicit ready and terminal closure                                                                  |
| Redis degradation/admission remains bounded                     | Existing auth/realtime/transport suites: disposable Redis failure/recovery, denial, drain and accepted work completion                                                                                         |
| Worker retry/drain preserves truth                              | Existing outbox/cleanup/automation/statistics suites: delivery fences, publish-before-mark loss, dedupe, queue connection loss, in-flight drain and rebuild                                                    |
| Account → Invite → Play → Finish → Stats                        | Release browser suite: verified synthetic launch, UI onboarding/create/invite/join/start/ready, real Coup, escaped chat, Worker reconstruction, one result/application and closed room                         |
| Account → Find → Play → Finish → Stats                          | Release browser suite: real queue/reservation/admission, explicit ready, offline controls disabled, missed-event catch-up, real finish and projected profile/leaderboard                                       |
| Invalid launch and ambiguous room mutation                      | Release browser suite: tampered launch rejected without account creation; committed create response lost, retry keeps one ID/room; drain definitively denies leave, restart preserves room, new leave succeeds |
| Failed browser diagnostics preserve privacy                     | Release privacy gate: two intentionally failing child cases use the actual scalar/private-button helpers; captured output and generated reports contain neither the private canary nor ARIA snapshots          |
| Engine privacy/replay                                           | Existing Coup unit/model/golden suites; fifty-game model test has a fifteen-second local test budget without reducing generated games or changing gameplay timers                                              |

## Fixture boundaries and privacy

API-owned `release-server.mjs` injects a synthetic eligible CatalogPort and
explicit test rule/timer inputs. It asserts stored production Coup remains
disabled. Private creation uses the approved Matches-owned port and bounded
recovery; matchmaking uses real queue/admission ports. Both require explicit
readiness. Randomness uses the existing server CSPRNG adapter. UI buttons drive
game intents; snapshots/results are never fabricated. Worker-owned
`release-worker.mjs` receives only its database/Redis credentials and isolation
guards, and runs real outbox/statistics components. Trusted controls exist only
on loopback in test files, absent from product composition.

Receipt-count reconciliation opens a separate Worker-role connection in the
trusted fixture. The API role cannot read application receipts; production
grants are never broadened for audits.

API restart reconstructs HTTP/Socket composition inside the fixture process;
Worker reconstruction starts a new child process. The retained integration
suites separately exercise PostgreSQL process restart and cross-process Match
reconnect. These scopes are recorded separately from deployment/node-kill drills.

Synthetic Telegram launch and access/admission credentials remain in test
memory. Scalar audits contain IDs, versions, status and counts, never game
state, cards, decks, RNG material or chat content. Raw recipient snapshots are
checked before client schema stripping; existing information-flow tests cover
other players' hidden information. Credential storage assertions report only
booleans. API telemetry is discarded; Worker output is disabled and IPC reports
only readiness. Startup errors report fixed stages without raw connection
diagnostics. Playwright trace/video/screenshots are off;
`PLAYWRIGHT_NO_COPY_PROMPT` suppresses recorder accessibility failure snapshots
that could capture the recipient's private cards. Locator matcher failures need
the separate protections below.

Game-button errors are replaced by a fixed test error before reporting, because
Playwright's resolved-element call log can contain the button's private card label.
Game-page assertions poll scalars instead of using locator matchers, whose failure
ARIA snapshots bypass the recorder flag. The driver correlates real Socket.IO
game acknowledgements and waits for engine revision, rather than treating a
presence-only Match version increase as an accepted command. Definitive stale
version rejections synchronize before a bounded new intent.

The fifth release case runs two intentionally failing child browser cases against
these actual helpers, with a unique private canary in the DOM. It checks the
captured command output and both generated error reports for canary/ARIA absence,
then removes its owned temporary files. A passing negative gate complements the
four MVP cases; it does not make arbitrary future locator assertions safe.

These suites do not measure public TLS/ingress, Telegram mobile WebViews, live
bot delivery, final quotas, load, reconnect storms or a two-hour soak. They do
not resolve open decisions or activate gameplay under Phase 7C.

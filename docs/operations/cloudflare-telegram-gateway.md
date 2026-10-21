# Cloudflare ↔ VPS Telegram gateway

**Gateway active; both directions passed a real owner-authored `/start` exchange.**
The existing Worker at `https://telegram-bot-server.aeinidev77.workers.dev` still
owns Telegram's webhook. The new source is
[`apps/bot/src/cloudflare/worker.ts`](../../apps/bot/src/cloudflare/worker.ts).
The VPS application and private API remain the authority for accounts and games.
See [ADR-074](../adr/074-cloudflare-telegram-gateway.md).

## Qualification observations on 2026-10-21

The owner published the prepared Worker and its authenticated relay returned the
expected bot identity. The VPS's default Node connection completed TLS but then
stalled; a scoped `node:https` transport using standard
`X25519:P-256:P-384` groups returned HTTP 200 from the same container with verified
TLS 1.3. `createRelayTransport` applies this only to relay calls. Certificate and
hostname verification remain enabled; global TLS and fetch settings are unchanged.
An actual SDK `getMe`/`getWebhookInfo` probe from the Bot container passed without
sending messages. This established egress before the final switch. The subsequent native exchange
and durable receipt are recorded below.

The isolated candidate passed frozen installation and the complete `pnpm check`;
Bot's separate real-TLS suite passed 41 cases. Fresh native secret detection was
assessed with the existing, byte-verified `b55907a` public-provenance assessor;
the unchanged historical false-positive contexts remain exact, with no new ignore.

The full repository dependency audit now reports two Moderate and one High Vite
development findings. Its result remains **blocked**, and no policy exception or
dependency ignore was added. The High finding is the Windows editor-launch issue
[GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm), updated
2026-10-20. The Bot production-closure audit (`pnpm --filter @hambazi/bot... audit
--prod --json`) separately reports zero findings. This deployment selects only the
production Bot image; the installer additionally requires that Vite and
launch-editor packages be absent from it, plus the unchanged image severity gate.
That qualification does not clear the repository-wide development audit or approve
a general release. Production remains HOLD; the Vite tooling remediation is still
outstanding.

```text
Telegram → Worker /webhook → VPS Bot → private API → PostgreSQL
                             VPS Bot → Worker /v1/sendMessage → Telegram
Mini App ───────────────────────────→ public API / WebSocket
```

## VPS cutover observed at 2026-10-21 08:01 UTC

Only Bot was replaced, from snapshot `e86843e` to private immutable snapshot
`5a507c0e95a076fde2c2140021cdd6ced1020433`. The pinned Bot digest is
`sha256:ca8742cfa47df5cddba65ebb14f90aaea465979ebd90a89d3091dcd33dcc6a06`.
Its transferred archive SHA-256 and source/build labels matched. The production
image contains no Vite or launch-editor package. The previous Bot exited cleanly
with code 0. API, Worker, Web, PostgreSQL and Redis retained their exact container
IDs, image IDs and start times; no database migration was performed.

The actual newly running Bot passed `getMe` with the expected identity,
`getWebhookInfo` with the existing Worker URL, and private LIVE/READY checks.
There were zero pending Telegram updates; a historical delivery error was still
reported, so native incoming delivery is not claimed from this probe. Worker
health was configured with forwarding disabled. Public nginx route probes from
the origin passed verified TLS: Web 200, private health/internal routes 404 and
an unauthenticated Bot webhook 401. The local proxy's separate HTTP probes were
unreliable and are not counted as external acceptance.

The replacement control was rebound only to the new Bot identity and changed
Bot env/Compose hashes. Verification and fresh native scans of all six active
images passed; both renewal and independent expiry timers are active. At the
observation, genuine advisory metadata left the finite deadline at
**2026-10-21 13:14:22 UTC**; no artificial extension was applied. Consult current
private state for subsequent renewal. Evidence, rollback env/Compose/control and
the source bundle remain in `/opt/hambazi/evidence/cloudflare-20261021` (root-only).
The [deployment binding](../../infra/docker/server/deployment.json) records the
mixed active sources explicitly; API/Worker/Web remain on the original snapshot.

## Native acceptance observed at 2026-10-21 11:26 UTC

The owner enabled `GATEWAY_ENABLED=true`, deployed, and reported receiving the
reply to `/start`. A fresh health request from the actual Bot container returned
HTTP 200 with `configured=true` and `forwardingEnabled=true`. The private Auth
receipt aggregate contains one new `START` receipt in `DONE`, received at
2026-10-21 08:20:27.870 UTC, after this Bot installation. Before forwarding there
were no receipts from this deployment. `DONE` is committed through the existing
acknowledgement path after Telegram accepts the outgoing reply.

An authenticated SDK recheck confirmed the expected bot and unchanged Worker
webhook, with zero pending updates. Telegram still reports the historical error
from 2026-10-20 23:35:41 UTC; it predates this successful exchange and has not been
represented as a new delivery failure. Exact replacement verification still
passes and both security timers are active; the 11:01 UTC renewal passed with the
same finite deadline noted above. Private `gateway-acceptance.json` and aggregate
receipt evidence are retained locally and on the VPS.

A subsequent official database download into an empty private cache retrieved
native metadata `UpdatedAt=2026-10-21T07:13:45.702547343Z`. The pinned Trivy binary
and metadata were verified; the previous DB was preserved, the renewal timer was
paused during cache promotion, and the unchanged controller rescanned all six
active images successfully. It renewed the genuine finite deadline to
**2026-10-22 07:13:45 UTC** (10:43:45 Tehran). The independent expiry remained active;
no timestamp was edited and no severity exception was introduced. The ordinary
Trivy download may reuse a cache until its native `NextUpdate`; an active hourly
timer alone does not guarantee fresher advisory data. Operators must verify actual
renewals before this finite deadline and use a genuine fresh download if needed.

This accepts Telegram → Cloudflare → VPS Bot/private API → Cloudflare → Telegram.
It does not claim a native duplicate-redelivery exercise or a full two-player game;
those were not performed. Public admission and general production release remain
HOLD, and the existing restricted owner/tester policy remains in force.

## Required deployment inputs

| Location                   | Setting                   | Purpose                                                                                                                              |
| -------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare Secret          | `BOT_TOKEN`               | The same bot identity as the VPS; already present in the standalone Worker.                                                          |
| Cloudflare Secret          | `PROXY_SHARED_SECRET`     | Independent random canonical base64url relay credential, 43–128 characters.                                                          |
| Cloudflare Secret          | `VPS_WEBHOOK_SECRET`      | Matches the current VPS Bot's `TELEGRAM_WEBHOOK_SECRET`; independent of the relay credential.                                        |
| Worker variable            | `VPS_WEBHOOK_URL`         | `https://bot-staging.hambazi.top/v1/telegram/webhook`                                                                                |
| Worker variable            | `GATEWAY_ENABLED`         | Initially `false` (also the default); set `true` only after VPS relay qualification.                                                 |
| Optional Cloudflare Secret | `TELEGRAM_WEBHOOK_SECRET` | Existing incoming Telegram secret, only when explicitly configured. Absent preserves the standalone Worker's SHA-256-derived secret. |
| VPS Bot-only env           | `TELEGRAM_API_PROXY_URL`  | `https://telegram-bot-server.aeinidev77.workers.dev`                                                                                 |
| VPS Bot-only secret        | `TELEGRAM_API_PROXY_KEY`  | Same bytes as `PROXY_SHARED_SECRET`. Never put in the Web app or source.                                                             |

The existing VPS Bot token, service credential, private origin, admission and TLS
remain required. The relay pair is optional and validated together. No API,
Worker or Web service receives the relay credential.
In the first relay-only stage, only the existing `BOT_TOKEN` and new
`PROXY_SHARED_SECRET` are needed on Cloudflare. The VPS URL/secret are required
when enabling forwarding. The standalone commands are retained until then.

## Build and local checks

Use the existing scripts:

```sh
pnpm --filter @hambazi/config build
pnpm --filter @hambazi/config typecheck
pnpm --filter @hambazi/config test
pnpm --filter @hambazi/bot typecheck
pnpm --filter @hambazi/bot test
pnpm --filter @hambazi/bot test:integration
pnpm --filter @hambazi/bot build
pnpm check:architecture
```

The standalone Worker output is `apps/bot/dist/cloudflare/worker.js`; it imports
no Node/SDK/database module and uses Web APIs. Publish that module to the existing
Worker, using Cloudflare's dashboard or an already authenticated deployment setup.
This repository does not currently declare/install Wrangler; no new deployment
script or Cloudflare login is claimed. Preserve the old deployed version before
replacing it. The old public `/api/setup` token-entry UI is intentionally absent
from the gateway; it is not needed to retain the registered webhook.

## Activation sequence

1. Qualify VPS-to-Worker reachability with the actual Bot transport. Initial
   Python HTTPS received Cloudflare HTTP 403/code 1010, curl timed out, and default
   Node fetch stalled. The scoped verified Node HTTPS transport described above
   subsequently passed. Do not substitute an unrelated client result for the
   deployed transport or disable TLS verification and Cloudflare protections.
2. Preserve the current Worker version/source and private VPS configuration.
   Add the new `PROXY_SHARED_SECRET` first, keep the existing `BOT_TOKEN`, and
   publish the module with `GATEWAY_ENABLED=false`. The old standalone commands
   continue working while the authenticated egress routes become available.
   Keep queued Telegram
   updates. Do not call `getUpdates`, delete/set the webhook unnecessarily or
   drop pending updates.
3. Review provider observability so it does not capture raw bodies,
   credentials, or outbound Telegram URLs containing the bot token.
4. From the VPS, verify `/health` returns configured gateway status, unauthenticated
   `/v1/getMe` is denied, and an authenticated POST `/v1/getMe` returns the exact
   existing bot identity. Test TLS and JSON response bounds. Read
   `/v1/getWebhookInfo` through the relay to confirm the existing URL/backlog.
   Do not send arbitrary user messages as a connectivity probe.
5. Build/qualify a new pinned Bot image using the repository release process;
   configure the relay pair only in its private role env. Scan changed artifacts,
   retain database/queues and review/rebind the replacement controller's exact
   image/container/file controls before the finite expiry. This changes config
   and image identity; merely restarting the old image cannot add this feature.
6. Verify Bot→private API admission and readiness. Check active games and arrange
   the final Bot cutover. Install `VPS_WEBHOOK_SECRET` and the exact
   `VPS_WEBHOOK_URL`, then set `GATEWAY_ENABLED=true` on Cloudflare. Only now does
   the Worker forward incoming updates to the VPS. Origin failures return 503
   for Telegram retry; do not claim complete delivery during a failed cutover.
   Then exercise the full
   Telegram→Worker→VPS Bot→Worker→Telegram path with an owner-authored message.
   Confirm durable acknowledgement and no duplicate account effect on redelivery.
   Recheck Mini App session identity, profile and owner/tester admission.
7. Record actual deployment hashes, security expiry and observed native result.
   Keep production HOLD until its independent gates pass.

The gateway performs no game or account processing. It allows only JSON POSTs to
the documented seven Telegram methods. Incoming and outgoing bodies are bounded;
query-bearing and arbitrary routes, polling, webhook-setting and file routes are
rejected. On the VPS, the SDK uses a fixed-origin fetch adapter, preserves the
caller deadline, rejects redirects/HTML/oversized output, sanitizes errors and
never retries or silently falls back to a blocked direct route.

## Rollback and remaining evidence

Restore the preserved Worker version and the previous qualified Bot image/env
under the normal maintenance/rebinding procedure. Preserve durable accounts,
receipts, pending updates and data services. Removing the relay pair restores
direct outbound behavior, which remains unreachable in the last VPS probe.
Neither rollback nor deployment requires database migration or a Redis flush.

Local tests cover actual grammY through an injected gateway/Telegram transport,
secret isolation, webhook forwarding, denied unauthenticated routes, origin
failure, flood hints, redirects, size limits and cancellation. Existing Bot
real-TLS integration tests remain required. Local tests alone do not prove live deployment. The dated acceptance above
separately establishes live reachability and one native reply; native two-player
play remains pending.

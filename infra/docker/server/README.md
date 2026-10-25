# Replacement restricted staging operations

Target: **89.46.217.9**, Docker project `hambazi-server`.
See [deployment record](../../../docs/operations/replacement-server-20261020.md)
and [ADR-073](../../../docs/adr/073-replacement-restricted-staging-server.md).
The tracked Compose/nginx files contain topology and pins, not credentials.
Runtime files are `/opt/hambazi/private/compose.json` and
`/etc/nginx/sites-available/hambazi`. Private role files, TLS keys and admission
identities already exist on this host. Merely copying this directory to another
host does not recreate them or recover the database.

The [2026-10-23 recovery](../../../docs/operations/staging-recovery-20261023.md)
replaced all six images with musl security derivatives of the same application
sources. Current pins are in `deployment.json` and `compose.yaml`.

The [palace lobby release](../../../docs/operations/kahroba-palace-deployment-20261023.md)
then replaced API/Worker/Web and applied a WebSocket-only Web correction. Kahroba
now opens from its main game card; the separate private-table link is removed.
Bot/data images, admission and the database were preserved. Per-role source
identities are recorded in `currentApplicationSources`.

The [compact Web release](../../../docs/operations/compact-viewport-deployment-20261023.md)
restored the original main-lobby layout and deployed compact presentation for the
other screens, optimized images, Brotli/gzip and public-asset caching. Only the
Web container was recreated; static ingress now forwards encoding negotiation
and cache validators. API/Worker/Bot/data image and container identities remain
unchanged. Consult the current per-role pins and security state.

The [fantasy main-lobby release](../../../docs/operations/fantasy-main-lobby-deployment-20261023.md)
adds the reviewed activity rows, sculpted icons and fixed five-item dock. Counts
remain owner-approved placeholders until live statistics exist. Only Web was
recreated after the owner requested termination of the single active game through
the guarded lifecycle. The previous role/data pins, admission and ingress remain.

The [2026-10-24 layout restoration](../../../docs/operations/layout-restoration-deployment-20261024.md)
removes the compact viewport experiment from all remaining pages while retaining
the current fantasy home and optimized static delivery. A required signed Alpine
brotli-libs update also replaced the PostgreSQL image while preserving its binary
version, configuration and data volume. API/Worker/Bot/Redis pins, admission and
ingress are preserved.

The [content-aware page release](../../../docs/operations/natural-page-layout-deployment-20261024.md)
adapts short lobbies, profile/settings, Coup entry and Kahroba lobby forms to the
available screen height. Extra content retains natural scrolling. The Kahroba
game is unchanged. Only Web was recreated; all other pins and identities remain.

The [fitted-page touch release](../../../docs/operations/fitted-page-scroll-deployment-20261024.md)
prevents elastic vertical dragging only while opted-in pages fit the visible
viewport. Added content, keyboard/zoom states and long sheets retain scrolling.
The Kahroba game remains unchanged; only Web was recreated.

The [main-lobby game-list release](../../../docs/operations/main-lobby-game-scroll-deployment-20261024.md)
keeps the lobby stationary while added games scroll inside the catalog. A required
Zod 4.6.6 security derivative also recreates API/Bot/Worker while preserving their
application runtime bytes; data services, admission and ingress remain unchanged.

The [future-game covers release](../../../docs/operations/future-games-deployment-20261024.md)
adds UNO and Battleship as disabled coming-soon cards with optimized covers.
Only Web was recreated; backend and data identities remain unchanged.

The [fantasy loading release](../../../docs/operations/fantasy-loading-deployment-20261024.md)
redesigns the launch screen with inline SVG, responsive styling and reduced-motion
support. Only Web was recreated.

The [launch guard release](../../../docs/operations/launch-guard-deployment-20261025.md)
hides the guest header and keeps the launch loader visible for at least three
seconds while requests proceed concurrently. Only Web was recreated.

The [crystal loading release](../../../docs/operations/crystal-loading-deployment-20261025.md)
updates the static and React launch artwork and stages loader departure and lobby
arrival. The arrival uses opacity to preserve fixed dock positioning. Only Web
was recreated.

The [fantasy tabletop loading release](../../../docs/operations/tabletop-loading-deployment-20261025.md)
adds responsive fantasy board-game artwork to the static and React launch screens.
The existing loader departure and lobby arrival remain. The arrival uses opacity to preserve fixed dock positioning. Only Web
was recreated.

The [Telegram welcome release](../../../docs/operations/telegram-welcome-deployment-20261025.md)
adds a responsive fantasy entry page with clearer browser/expired-session guidance
and a link to the existing Telegram bot. Only Web was recreated.

The [extended loading release](../../../docs/operations/extended-loading-deployment-20261025.md) extends the fantasy artwork to the top of the loading screen and removes its eyebrow copy. Only Web was recreated.

The [desktop window release](../../../docs/operations/desktop-window-deployment-20261025.md) limits automatic fullscreen to mobile Telegram clients and adds a 430px portrait content frame in wide desktop browser windows. Only Web was recreated.

## Inspect without exposing secrets

Run these commands on the destination. Do not print rendered Compose or full
Docker inspection output: they may include credentials.

```sh
docker compose --env-file /dev/null --file /opt/hambazi/private/compose.json config --quiet
docker ps --format '{{.Names}} {{.Status}} {{.Ports}}'
python3 /opt/hambazi/ops/replacement-security.py --verify
systemctl status hambazi-server-security-renew.timer hambazi-server-security-expiry.timer --no-pager
cat /opt/hambazi/security/state.json /opt/hambazi/security/last-run.json
```

Public health endpoints are deliberately absent. Internal readiness can be
inspected inside each application container at `/v1/health/ready` (API/Web 8081,
Bot 8082, Worker 8083). Bot readiness does not test external Telegram delivery.
nginx and Certbot run on the host. `certbot.timer` renews public certificates;
its deploy hook validates and reloads nginx. Review/rebind any changed certificate
or host package control before the current security deadline.

## Maintenance and security renewal

The persistent hourly `hambazi-server-security-renew.timer` invokes the bound
controller. A successful run may advance the independent finite expiry, using
fresh official advisories. It cannot deploy, start applications or reopen nginx.
One successful repeated download does not establish newer advisory data. Inspect
the current state file rather than relying on the deployment day's deadline.

To request immediate maintenance after checking active play and arranging a drain:

```sh
systemctl start hambazi-server-security-contain.service
```

This is an explicit immediate operation even before expiry: it verifies this
host/container identity, applies the private maintenance nginx file, and gracefully
stops Bot, API, Worker and Web. Data services and the PostgreSQL volume remain.
The expiry timer invokes the same operation automatically. Application stop is
attempted even if nginx validation/reload fails. Inspect unit status and private
failure evidence; a partial failure is not successful maintenance.

To revoke automatic renewal, first set `active` to `false` in the root-only
`/opt/hambazi/security/control.json`, then disable/stop the renewal timer and stop
any in-flight renewal service. Preserve the independent expiry timer. The
controller rechecks revocation before changing the deadline. Do not substitute
the previous server's units, images, credentials or expiry exceptions.

## Manual restart and reopening

Only restart after confirming the maintenance cause is resolved, fresh scan
evidence passes, controls match and the installed expiry leaves enough time for
verification. A controller `--renew` requires healthy applications and at least
15 minutes remaining; it cannot revive an expired deployment. An expired or
changed installation needs reviewed evidence and explicit control rebinding.

Under maintenance, start existing application containers in order Worker, API,
Bot, Web, keeping container identities and image pins intact:

```sh
docker start hambazi-server-worker-1
docker start hambazi-server-api-1
docker start hambazi-server-bot-1
docker start hambazi-server-web-1
```

Wait for strict private READY checks, verify the six image/container identities
and current scan/admission/role/TLS controls, then deliberately restore the reviewed
live file `/opt/hambazi/private/https-live.conf` to the nginx site. Run `nginx -t`
before reload. Recheck HTTPS, browser headers/assets, protected routes and WSS;
on failure restore `/opt/hambazi/evidence/https-maintenance.conf` and drain again.
Once live, `--verify` must pass and the hourly renewal timer must remain enabled
unless the owner revoked it. No renewal code performs this reopening sequence.

For a new source/image/configuration, qualify the change under maintenance,
preserve the previous snapshot and database, and rebuild the private identity/file
binding from actual deployment evidence. A container recreation changes its ID;
do not edit the expected ID just to make a failed check green. A security rollback
also needs currently acceptable images, migrations and controls. PostgreSQL volume
`hambazi-server-postgres-20261020` is the durable new database: never remove it as
part of an application restart or use `down --volumes` for rollback.

## Telegram and pending acceptance

Webhook/menu settings already target the new HTTPS origins; the backlog was
retained. Destination outbound Telegram TLS currently fails. Restore a reachable
egress route/proxy, introduce any required settings through private role files,
and review/rebind the resulting controls. Do not bypass certificate validation.
Recheck actual Bot replies and owner/tester invitation → join → ready → host start
→ play → finish in Telegram. That native acceptance, the existing packaged-browser
button assertion failure, and recovery/load tests remain recorded limitations.

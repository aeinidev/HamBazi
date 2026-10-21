# Replacement restricted staging operations

Target: **89.46.217.9**, Docker project `hambazi-server`.
See [deployment record](../../../docs/operations/replacement-server-20261020.md)
and [ADR-073](../../../docs/adr/073-replacement-restricted-staging-server.md).
The tracked Compose/nginx files contain topology and pins, not credentials.
Runtime files are `/opt/hambazi/private/compose.json` and
`/etc/nginx/sites-available/hambazi`. Private role files, TLS keys and admission
identities already exist on this host. Merely copying this directory to another
host does not recreate them or recover the database.

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

# Mini App staging recovery — 2026-11-07

The owner requested restoration of the Mini App. Direct HTTPS returned nginx 503.
SSH inspection confirmed expiration of the core security evidence at
`2026-11-07T01:07:43Z` (04:37 Tehran). All four application containers and Admin
were stopped cleanly; PostgreSQL and Redis remained running.

Fresh exact-image scans reproduced the renewal blocker: CVE-2026-85091, HIGH,
in `zlib 1.3.2-r0` on PostgreSQL and Redis. The four application images passed
with one allowed MEDIUM finding each. This incident was not a recurrence of the
previous advisory-cache refresh bug. The [Alpine security tracker](https://security.alpinelinux.org/vuln/CVE-2026-85091)
lists the fix; the signed stable repositories now provide `zlib 1.4-r0`.

Only the two data images were extended from their exact active parent pins.
Package inventory comparisons verified that only zlib changed, and isolated
`postgres --version` / `redis-server --version` comparisons remained identical.
Fresh scans of both replacement images reported zero findings. The six-image
qualification passed without changing severity thresholds, controller source or
freshness policy. The new data pins are recorded in
[`deployment.json`](../../infra/docker/server/deployment.json), under
`zlibSecurityPatch`.

Before replacement, with every application writer stopped, a full cluster
`pg_dumpall` was streamed directly into CMS AES-256-GCM encryption with the
existing owner's public recipient certificate. No plaintext dump file was written.
The encrypted archive was copied outside the VPS; both copies matched SHA-256
`243a5faab0cd4101c5a1455fb3178e205968e1193198ae588d234f831bd28664`.
CMS structure was checked. **This new backup was not decrypted or restore-tested.**
The local copy is under
`/home/mehdi/.local/share/hambazi/backups/staging/20261107-zlib/`.

The same PostgreSQL volume and service versions were retained. No migration,
schema/data restore, admission change, credential change or new application
deployment occurred. The four Phase 3 application containers were restarted with
their existing identities and images, from source `c7add7b` / build `5161e94f91139e1a`:

| Role   | Active image digest                                                       |
| ------ | ------------------------------------------------------------------------- |
| API    | `sha256:bd36e21894ab62c4c7ce00674405924545a8eff8382d033598c49ba9326cb5f9` |
| Bot    | `sha256:9c85b3dfcf1cffef1a0eef26d3f8078097fe198915955654bbfbee4da4a23ad8` |
| Worker | `sha256:e891d537505b1d6c65ff291496d4062a86d294598ee795dbd2b24dc760398338` |
| Web    | `sha256:a9a375113e3db3d745c6ef00a42ef695d2bea0678f2fa65954dd1060053aa2a6` |

Strict application readiness, host packages, bound configuration and isolation
controls were checked under maintenance. Only the two reviewed data-container
identities and the live Compose hash were rebound. Fresh scan evidence established
the core deadline `2026-11-08T12:52:01Z` (16:22 Tehran). nginx validation and the
complete core verifier passed before ingress reopened. The original bootstrap
`compose-data.json` was preserved as historical configuration; current runtime
uses `/opt/hambazi/private/compose.json`.

The real systemd renewal succeeded at `2026-11-07T16:35:38Z`, fetched fresh
official advisories and rechecked all six active images. It retained the same
finite deadline. Both hourly renewal and independent expiry remain enabled.

Disk usage was also 95% before recovery. Only four obsolete public advisory
database cache files from October 24/25 releases were removed, freeing
6,536,015,872 bytes. Their metadata and scan reports, active caches, backups,
application images and PostgreSQL volume were preserved. After recovery the disk
had approximately 7.9 GiB available (87% used).

Public Web returned 200. Chromium loaded the page and seven successful responses
with no failed same-origin responses, fatal JavaScript errors or local/session
storage entries. Unauthenticated `/v1/me` returned 401; health and Admin paths on
the player API returned 404. Full authenticated Telegram gameplay and load tests
were not performed. No application code changed, so no application build or full
unit suite was rerun.

Admin was outside this Mini App recovery and remains contained; its independent
expiry/maintenance controls were preserved. No Phase 4 candidate or current local
work in progress was deployed. Original controls, Compose, encrypted backup,
build logs, package checks and scan evidence remain private in
`/opt/hambazi/security/recovery-20261107`. Future security findings or feed outages
can still require containment under the unchanged policy.

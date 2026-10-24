# Restricted staging recovery — 2026-10-23

The Web, API and Bot origins returned nginx 503. SSH inspection confirmed that
the finite security deadline, `2026-10-22T07:13:45Z` (10:43 Tehran), had expired.
Containment stopped the four application containers cleanly. PostgreSQL and Redis
remained running. This was an intentional maintenance response, not host loss.

The last successful renewal retained the previous advisory metadata. Trivy's
cached `NextUpdate` matched the evidence deadline; `--download-db-only` could skip
fetching until that time. The renewal controller also refuses renewal with less
than 15 minutes remaining, so later scheduled attempts could not recover it.
The controller now downloads into an empty temporary cache on each attempt.
Genuine update/download timestamps, the 24-hour deadline and severity gate remain
unchanged. Feed outages or unavailable qualifying images can still require
containment; this change does not guarantee uninterrupted availability.

A fresh official database identified CVE-2026-107891 in musl/musl-utils on all six
deployed images. Alpine's [security release announcement](https://www.alpinelinux.org/posts/Alpine-3.21.9-3.22.7-3.23.7-3.24.3-released.html)
describes the vendor fix. Each existing image was extended using its exact parent
pin and signed Alpine package upgrades for musl/musl-utils. Application code,
admission identities, private role settings and database schema were unchanged.
No local application work in progress was deployed. The public
[deployment binding](../../infra/docker/server/deployment.json) records parent and
replacement pins.

Recovery ran under maintenance. A private custom-format `pg_dump` archive was
created and its archive listing verified before container replacement. The same
PostgreSQL volume, `hambazi-server-postgres-20261020`, was retained. This local
archive is not an offsite backup or a tested restore.

All six replacement images passed fresh exact-image scans with no
High/Critical/Unknown findings; allowed Moderate/Low findings remain. Actual
container/image identities, unchanged controls, private readiness and the patched
controller were reviewed and rebound. The independent expiry timer was installed
with the initial fresh deadline `2026-10-24T01:18:09Z` (04:48 Tehran). nginx was
validated before live ingress was restored. An actual systemd renewal completed
successfully at `2026-10-23T07:25:36Z`, fetched newer advisory metadata and advanced
the deadline to `2026-10-24T07:12:39Z` (10:42 Tehran). Automatic renewal and
independent expiry remain enabled; admission remains limited to the existing two
identities.

Verification: four strict private READY checks and the complete control verifier
passed. The public Web returned 200; Chromium loaded seven successful responses
with no failed responses or fatal page errors and no local/session storage
entries. Unauthenticated `/v1/me` returned 401 and protected health/admin paths
returned 404. The ten focused renewal tests, targeted ESLint and formatting checks
passed. Full native Telegram gameplay, authenticated two-player acceptance, load
testing and backup restore were not performed by this incident recovery.

Private evidence, package build logs, original controls/Compose, scan reports and
the database archive remain in `/opt/hambazi/security/recovery-20261023` on the
destination. Do not expose these files or treat the previous vulnerable images
as an acceptable security rollback.

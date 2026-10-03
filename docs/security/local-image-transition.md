# Local service image setup and transition

[ADR-035](../adr/035-local-service-image-remediation.md) records the owner-approved
scope, input/output pins and compatibility limits. This runbook concerns the
local PostgreSQL/Redis services only. It does not deploy or migrate real data.

## Prepare the selected images

Use the pinned Node/pnpm toolchain and frozen installation. Docker/BuildKit must
support timestamp rewriting and retention of locally built manifest references;
the verified setup is Docker 29.8.1 with its containerd image store, Buildx 0.37.1
and BuildKit 0.33.0 on Linux amd64. Build inputs and output are locked in
`infra/docker/postgres/image-lock.json`. Run from the repository root:

```sh
pnpm install --frozen-lockfile
node infra/scripts/build-local-postgres.mjs
docker pull redis:8.10.2-alpine3.23@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0
```

The builder downloads only the two exact pinned Alpine APKs over verified HTTPS,
checks hashes/size, and installs them with signature verification inside the
network-disabled build. For separately provisioned verified archives, set
`HAMBAZI_POSTGRES_HELPER_ARCHIVE` and `HAMBAZI_POSTGRES_HTTP2_ARCHIVE` to their
private absolute paths; the same hashes remain mandatory. It never prints build
diagnostics, modifies `.env`, starts a service, pushes an image or silently accepts
a different digest. A failed integrity/build gate must be investigated; do not
retag a different result to bypass it. Do not pull the local PostgreSQL alias.

Direct Node HTTPS fetching timed out in the reviewed environment. Both
pre-provisioned archive mode and `node --use-env-proxy infra/scripts/build-local-postgres.mjs` using the environment's approved HTTPS
proxy reproduced the locked digest. Use the latter only where that proxy is
configured. Provisioning must preserve TLS verification, byte hashes and normal
APK signatures; never bypass those checks to recover from a network failure.

Run the uncached checks in [scanning.md](scanning.md). Ordinary declared
`infra:env`, `infra:config`, `infra:up/status/down` commands remain unchanged.
The default PostgreSQL volume name is preserved, including a selected Compose
project name. A clean new volume initializes UTF8 with builtin `C.UTF-8` and the
existing API/Worker/migrator role boundary. Redis still loses coordination data
on restart; it remains unsuitable for durable Match truth.

## Existing PostgreSQL volume

A legacy populated volume has no image-policy marker and is refused before the
database entrypoint starts, with `POSTGRES_IMAGE_MIGRATION_REQUIRED`/exit 78.
Changing initdb environment does not migrate existing data. Never create a marker
by hand, attach the legacy volume under the new image, delete the volume, suppress
the guard or use `down --volumes` as a workaround.

For an actual local transition, an operator must inventory and preserve the old
volume/image/credentials, quiesce writers, produce a protected logical backup,
and select a **different fresh volume** through `POSTGRES_DATA_VOLUME` in the
private ignored environment. Bootstrap matching role identities, restore into
the empty target without replacing the source, and reconcile rows, constraints,
triggers, indexes, grants, sequences/defaults, Unicode behavior and any custom
extensions/collations before redirecting local clients. Preserve the source and
old configuration for an approved rollback; never start concurrent writers to
two copies of the same Match truth. Real credentials/password rotation and
backup disposition require their own operator scope. No live transition was
performed by Phase 17A1.

The new default is deliberately different from libc natural-language ordering;
the selected provider uses code-point ordering. The current application's sorted
database fields are numeric/UUID/ASCII, and the synthetic transfer checks bytes
and the existing schema. Custom language-aware indexes or third-party extensions
need additional evidence; this is not a universal physical-volume compatibility
claim or a final production locale choice.

## Disposable verification

```sh
node infra/scripts/test-postgres-transfer.mjs
TEST_POSTGRES_MODE=compose TEST_RESTORE_DRILL=isolated pnpm test:auth-http:local
```

The second command also requires the existing `TEST_POSTGRES_BIN` and, where
needed, `TEST_POSTGRES_SHARE`/client library environment documented in the database
foundation runbook. It still uses the supplied PostgreSQL 18 client tools for
logical backup/restore; it does not download/install host PostgreSQL.

The transfer script generates its own synthetic credentials and disposable
source/target services. It runs existing migrations and 17 foundation cases on
the exact legacy 18.6 Debian image, transfers the populated 29-table schema to
the selected image, checks logical equality/Unicode/JSONB/role guards and restart,
and destroys only its own containers, networks, volumes and private archives.
No existing service, environment, volume or external database target is accepted.
The full Compose-image mode runs the existing 218 DB/API/Worker integration cases
and 29-table restore drill against remediated PostgreSQL and Redis.

The disposable fixtures use separately named bridges with loopback publication.
On the tested Docker host, `--internal` suppressed host port publication; the
repository Compose network stays internal. These image/data checks therefore do
not verify full Compose host connectivity, production ingress, failover, image
signatures or arbitrary physical-volume upgrades. Those boundaries remain explicit.

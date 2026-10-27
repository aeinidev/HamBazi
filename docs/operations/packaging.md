# Portable application packaging

[ADR-042](../adr/042-portable-application-packaging.md) defines Phase 18B1.
These entry points create **local candidates**, never publish or deploy. OD-002,
OD-006 and OD-007 remain open. Provider, region, domains, access model, backup/PITR,
RPO/RTO, retention and final SLOs require explicit later approval. Parent 18B
remains In Progress. 17C is Completed for MVP with performance exceptions under
[ADR-048](../adr/048-mvp-capacity-acceptance.md); production-like capacity/soak
acceptance remains deferred and unproven.

## Build inputs and inventory

Use Node 24.22.1, root-declared pnpm 12.4.1 and compatible Docker buildx with the
containerd image store. Read the manifests/workspace/task graph, then install
with the declared `pnpm install --frozen-lockfile`. The standalone entry points
below are implemented files, not new guessed package scripts.

```sh
node --use-env-proxy infra/release/build.mjs /absolute/new/private/candidate
SECURITY_SCANNER_DIR=/absolute/private/verified-tools node infra/release/scan.mjs /absolute/new/private/candidate/images.json
TELEGRAM_SDK_FIXTURE_PATH=/absolute/private/verified-tools/telegram-web-app.js node infra/release/test-local.mjs /absolute/new/private/candidate/images.json
```

The build refuses an existing output directory or one inside the checkout. It
snapshots tracked/nonignored candidate files into a private temporary context,
hashes their bytes, and excludes `.env*`, keys/certificates, generated artifacts,
tests, VCS state and dependency folders from the Docker context. It never reads
the developer root `.env`. The context and raw build metadata are removed; the
mode-0600 `images.json` remains for review. Source may be dirty for local review;
`sourceDirty` and the full snapshot hash state that fact explicitly.

`infra/docker/apps/base-lock.json` pins the official Node amd64 base and two
official signed Alpine OpenSSL patch archives. The builder verifies archive
SHA-256 and APK verifies signatures offline. `HAMBAZI_APP_ARCHIVE_DIR` optionally
supplies `libcrypto3.apk` and `libssl3.apk` with exactly those hashes; it is not a
verification bypass. Base, archives, lockfile and policy changes require review
and fresh actual-image checks.

The four image entries are ordered API, Bot, Worker, Web. Each reference combines
a source/build-input tag with a manifest digest. Promote only a reviewed exact
digest in later authorized work; tags alone have no immutability guarantee.
Metadata records source commit/dirty status, snapshot/build-input hash and
lockfile/Dockerfile/base-lock hashes. Public API/Web/frame origins, if provided,
must pass the existing production browser policy and affect build identity.
No origins are selected by default; no environment file is loaded. The inventory
always states `productionReleaseApproved: false`.

## Runtime conventions

| Image  | Contents / entry point                                                  | Readiness                                               |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| API    | Compiled app and production workspace graph; `dist/composition/main.js` | Existing API loopback health, container default 8081    |
| Bot    | Compiled orchestration and production graph; `dist/composition/main.js` | Existing Bot loopback health, container default 8081    |
| Worker | Compiled consumers and production graph; `dist/composition/main.js`     | Existing Worker loopback health, container default 8081 |
| Web    | Built client and Web-owned `server/serve.mjs`; no runtime dependencies  | Separate loopback 8081; public static listener 8080     |

Every runtime is UID/GID 1000, defaults to `NODE_ENV=production`, uses direct Node
PID 1, a loopback-only Docker readiness probe and SIGTERM. Backend settings and
TLS/credential guards remain owned by the existing composition roots; packaging
does not supply secrets, weaken production validation or enable capabilities.
Consult the app's actual config manifest/code and existing runbooks for required
values. Health is not published through product routes. The probe accepts the
existing READY/DEGRADED semantics; readiness/drain acceptance against final SLOs
is still staging work.

Web requires its generated production `security-headers.json`, validates it
against the existing pinned SDK, serves only the bounded immutable public asset
inventory and applies the reviewed CSP/cache/security headers, including errors.
It has no request logging, raw payload capture, arbitrary SPA fallback or public
health route. `WEB_PORT`/`WEB_HEALTH_PORT` must differ and be unprivileged;
`WEB_BIND_ADDRESS` is explicit (container default `0.0.0.0`). These internal port
conventions and probe intervals do not select a provider, ingress, production
network or SLO. HTTPS/WSS ingress and actual origin/header enforcement remain
required before staging/release acceptance.

## Scans and disposable verification

The scan verifies local image UID/source/build labels and exact digest identity,
the existing hash-pinned Trivy, a private cache and fresh schema-2 advisory data.
It scans all four actual Docker images, with all vulnerabilities included.
High/Critical/unknown severity blocks even without a fix. Lower findings retain
the existing review policy. Only allowlisted public IDs/counts and image/hash
evidence leave the scanner; raw reports are deleted. The exclusive adjacent
`images.json.scan.json` refuses overwrite. Use a new candidate directory for a
new validation; do not replace evidence silently.

`test-local.mjs` accepts only this exact local candidate inventory, creates its
own PostgreSQL/Redis bridge/volume/ACLs and private synthetic environment files,
and cleans only resources it owns. It migrates a fresh disposable database and
repeats the declared database deployment. Each image runs with a read-only root,
dropped capabilities, no-new-privileges and a bounded noexec temporary mount.
Only the fixture TLS key and certificate are mounted; no shared directory of
role credentials is exposed. Fixture Bot/API share a network namespace solely
to exercise existing loopback TLS ports, not as a production networking design.

Production-default backend images reject missing configuration with fixed safe
startup errors. Functional backend smoke uses the existing explicit `test`
profile, distinct disposable database/Redis role credentials and synthetic
Telegram signatures; checks include auth/profile, queue startup, readiness and
clean SIGTERM. Web retains its production policy and runs two Chromium checks
against the actual image: built rendering/CSP and launch URL/storage privacy,
using unmodified integrity-verified official SDK bytes. No live Telegram update
or account, existing database, root `.env`, staging URL or gameplay activation is
used. No browser trace, video, screenshot or raw test report is exported.

The existing read-only CI sequence runs these real build/scan/smoke gates and
validates exact four-role scanner evidence against a clean source commit before
quality evidence export. No application image is uploaded or published. See
[CI operations](ci.md) for tool provisioning and trust boundaries.

## Deferred acceptance

Phase 18B2 provides [portable deployment preparation](deployment.md), production
configuration validation and expand/backfill/contract, drain and rollback procedures
with owned local rehearsals. Provider-specific provisioning/activation follows only after
explicit approval of the unresolved decisions and deployment scope. Production
TLS ingress, private service networks and credentials, immutable registry policy,
hosted CI, real staging migration/deploy/rollback, backup/PITR restore meeting
approved recovery objectives, mobile WebViews and final SLOs are unverified.
Local packaging cannot satisfy those gates, Phase 7C live activation, deferred
production capacity/reconnect/two-hour soak or Phase 19 final release readiness.

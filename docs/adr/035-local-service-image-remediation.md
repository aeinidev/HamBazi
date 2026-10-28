# ADR-035 — Approved local service image remediation and data boundary

- **Status:** Accepted following the owner's explicit approval of scoped image remediation and locale/data/role compatibility checks.
- **Owner:** HamBazi technical owner.
- **Date:** 2026-10-02.
- **Supersedes:** ADR-034's initial local image selection and pending image-remediation decision only. Its scan/failure policies remain intact.

## Context

The rebuilt Debian local images failed the Phase 17A1 gate with 16 Critical,
150 High and 8 Unknown package findings. The owner approved remediation, not a
risk exception or production deployment. Official Alpine Redis 8.10.2 scans
clean. Official PostgreSQL 18.6 Alpine 3.24 still includes a Go-based `gosu`
binary with blocking advisories. Its runtime HTTP/2 library also has a patched
Moderate advisory, CVE-2026-58055. Production app packaging remains Phase 18B.

## Decision

Use the official Redis 8.10.2/alpine3.23 digest in Compose. The maintainer marks
[8.10.2](https://github.com/redis/redis/releases/tag/8.10.2) as a security update.
Keep the existing Redis ACL, namespace, non-root user, ephemeral storage and
queue/outage behavior; verify the actual API/Worker integration suites.

Build a local PostgreSQL derivative from the official 18.6/alpine3.24 digest.
Install the locked, SHA-256-verified Alpine `su-exec` 0.3-r0 and `nghttp2-libs`
1.70.0-r0 APKs with normal Alpine signature verification and no build-step
network. Remove `gosu` and replace the one upstream privilege-drop call with
`su-exec`; preserve PostgreSQL binaries and the upstream initialization flow.
This removes the vulnerable executable rather than hiding its findings. Remove
the build-only APK log, whose embedded timestamp otherwise changes the digest.

`image-lock.json` pins the base, Dockerfile bytes, package versions/URLs/hashes,
platform, epoch and resulting local manifest digest. The standalone builder uses
a private minimal context, bounded verified HTTPS downloads or hash-checked
pre-provisioned archives, an uncached build and output digest/platform checks.
It does not start services or push images. Compose uses the exact derived digest
with `pull_policy: never`; operators must build it locally first. No external
registry or public image name is allocated by the local `hambazi-local` alias.

Fix build timestamps and disable varying local build attestations to obtain the
reviewed content digest. Repeated uncached builds, including a separate context,
match with Docker 29.8.1/containerd image store, Buildx 0.37.1 and BuildKit 0.33.0.
Both privately provisioned archives and HTTPS downloads through the configured
proxy reproduce the same digest; direct fetching timed out in this environment.
Other builder/platform versions must reproduce that digest or fail; Linux amd64
is the verified local target. This is not a signature/provenance attestation or a
production platform decision. Signed published application images remain 18B.

Initialize new local clusters as UTF8 with PostgreSQL's builtin `C.UTF-8` locale
provider. This avoids a libc-specific local default. It is a local test/developer
baseline, not the final production locale. Database ordering used by the current
product is numeric, UUID or ASCII identifiers; text bytes and Unicode are checked
in the real transfer and application suites. PostgreSQL documents that changing
[locale providers](https://www.postgresql.org/docs/18/locale.html) can change
text behavior. Do not assume an existing libc cluster is interchangeable.

Keep the existing named-volume default. Before invoking the upstream entrypoint,
the new wrapper refuses a populated directory lacking the verified local policy
marker, a wrong major version or a symlink marker, with fixed exit code 78. A final
initialization script verifies the actual builtin/UTF8 database and writes the
private marker only after role bootstrap. No old volume is automatically adopted,
reindexed, rewritten, deleted or marked compatible. The operator can select a
separately created volume through `POSTGRES_DATA_VOLUME`; legacy data requires a
logical transfer and reconciliation under [the transition runbook](../security/local-image-transition.md).

Extend the existing isolated database harness with an explicit
`TEST_POSTGRES_MODE=compose` backend. It runs the same migrations, suites, restart
and restore checks against the actual image/bootstrap. The fixture creates its
own names, credentials, loopback-published bridge and volumes. It never joins or
alters an existing network/volume. Docker internal networks on the tested host
do not expose the published host ports, so fixture networking differs from the
unchanged internal Compose network; full Compose host connectivity is not claimed.

## Alternatives

- Rebuilt Debian images alone leave blocking OS findings.
- Unmodified Alpine PostgreSQL leaves the vulnerable Go helper.
- Suppressing unfixed/unreachable findings violates the accepted gate.
- Alternative hardened registries add access dependencies: DHI requires account
  authentication, and the tested anonymous Chainguard pull returned 403. No account
  was created or provider commitment made.
- Automatically starting an old physical volume across libc/provider changes can
  invalidate collation/index assumptions. A fresh logical target is explicit.

## Consequences

The two selected images pass the fresh pinned scan without any finding exception.
The approved local derivative adds a small image-build responsibility and a
builder/platform compatibility requirement. Updates require reviewed inputs,
digest reproduction, scans and application/data compatibility evidence.

The actual image suite passes 218 integration cases plus a 29-table restore
rehearsal. A separate disposable Debian-to-remediated-image transfer passes 17
legacy foundation cases, reconciles all 29 public tables, constraints, triggers
and role/column grants, preserves Unicode/JSONB and source truth, rejects legacy
physical-volume adoption and verifies runtime role denial and restart persistence.
These synthetic local checks do not authorize or prove migration of real data,
arbitrary extensions/custom collations, offsite backup, staging networking or
production deployment. Root scripts and application contracts/grants are unchanged.

## Toolchain follow-up — 2026-10-28

The reproduction above records the original measured toolchain. Current CI uses
Docker 29.8.2 / BuildKit 0.33.1 under the dated amendment to ADR-041. Reproduction
must still match the locked PostgreSQL digest; the patch update does not permit
substituting an unreviewed service image.

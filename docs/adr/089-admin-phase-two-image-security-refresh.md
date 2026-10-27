# ADR-089 — Phase-two image security refresh

- **Status:** Accepted for local preparation and disposable qualification only; Staging installation requires separate owner approval.
- **Owner:** HamBazi technical owner.
- **Date:** 2026-10-27.
- **Supersedes:** Only the Node/image version pins of ADR-042; preserves ADR-034/035 scanning, ADR-079 OWNER protection and ADR-087 capability boundaries.

## Context

Fresh Trivy 0.74.0 / Alpine Secdb evidence blocks the old local Compose images:
PostgreSQL has HIGH CVE-2026-111497 in brotli-libs 1.2.0-r1 and
CVE-2026-92392 in libcurl 8.22.0-r0; both PostgreSQL and Redis have UNKNOWN
CVE-2026-107891 in musl/musl-utils. UNKNOWN is a real unfixed package finding,
not a false-positive classification. These observations are local and do not
describe the running Staging images.

Node 24.20.0 also embeds vulnerable Brotli and TLS/DNS code. Updating Alpine's
shared Brotli alone cannot patch the embedded Node binary. The official
24.22.1 LTS security release fixes these issues in the existing major line.
Upstream PostgreSQL also contains an old Go-built gosu; retain the existing
su-exec replacement instead of reintroducing that vulnerable executable.

The full disposable qualification also exposed thirteen existing Admin foreign
keys missing from the Prisma model. Align only the model with their actual names,
`ON DELETE RESTRICT` and `ON UPDATE NO ACTION`. Retain every database constraint
and OWNER/Audit trigger; do not apply the destructive SQL suggested by the old
model diff. This correction creates no migration and changes no stored data.
The restart harness also retained a historical count of fifteen migrations.
Compare the exact sorted names of successfully applied, non-rolled-back migrations
against the repository directories instead; preserve the restart and data assertions.

## Decision

1. Preserve PostgreSQL 18.6, Alpine 3.24, its built-in C.UTF-8 collation policy,
   Redis 8.10.2 and Alpine 3.23. Refresh the exact official amd64 base digests.
   PostgreSQL's existing offline, signed-APK derivative additionally installs
   pinned brotli-libs 1.2.1-r0 and libcurl 8.23.0-r0. Verify SHA-256 before
   building; APK signatures and network-disabled installation remain mandatory.
2. Use the official Node 24.22.1 Alpine 3.24 digest for build and runtime. Keep
   CI and packaging-host version pins aligned. Preserve frozen pnpm 12.4.1,
   application dependencies, least privilege and the existing removal of unused
   npm/Corepack/Yarn from final runtime images. Their absence is packaging, not
   a scanner exclusion; scan every final image's actual filesystem.
3. Build new local API/Bot/Worker/Web and Admin artifacts. Bind qualification to
   their exact identities and source snapshot. Require fresh complete scans,
   real runtime/integration/ingress/browser tests, data compatibility and
   disposable recovery/rollback evidence. Do not reuse another revision's
   inventory or extend any security deadline.
   Recognize only the exact commit/build/digest form of `hambazi-candidate/admin`
   in the existing scanner assessment; mutable Admin references and every
   HIGH/CRITICAL/UNKNOWN finding still fail. The four-role player inventory stays
   separate from the Admin artifact.
   Require zero Prisma-visible schema drift and repeat generation, type checks,
   integration, image build and exact-artifact qualification after model changes.
4. Never start these images against an existing developer or server volume.
   Compatibility/recovery uses owned temporary data and synthetic credentials.
   No Staging/Production/real OWNER change is authorized by this decision.
5. The owner explicitly deferred Load/Stress/capacity acceptance to the future
   server. Record it as **deferred and unverified**, not passed. Functional,
   security and artifact qualification remain mandatory for a Staging candidate;
   production capacity gates remain unchanged. USER_STATUS stays disabled.

## Alternatives

- Ignore UNKNOWN, suppress CVEs or weaken freshness: rejected; patched signed
  vendor packages are available.
- Patch only shared Brotli: rejected; Node statically embeds its own copy.
- Change database/Redis major, libc family or gameplay: unnecessary compatibility
  risk. Keep the existing major versions, data layout and state pins.
- Upgrade npm in final runtimes: unnecessary; those runtimes already omit the
  package manager and development tools.

## Consequences

Only local recipes, candidate pins and qualification change. Existing volume
guards and additive migration/rollback rules still apply. A clean scan is
time-bounded evidence, not a promise about future advisories. Before a separately
approved Staging install, recheck freshness, exact target digests and encrypted
off-server backup/restore; do not restore a stale dump over newer live data.

## References

- [Node 24.22.1 security release](https://nodejs.org/en/blog/release/v24.22.1)
- [Node October advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- [Brotli 1.2.1](https://github.com/google/brotli/releases/tag/v1.2.1)
- [curl advisory](https://curl.se/docs/CVE-2026-92392.html)
- [Alpine stable fixes](https://www.alpinelinux.org/posts/Alpine-3.21.9-3.22.7-3.23.7-3.24.3-released.html)
- [musl maintainer advisory](https://www.openwall.com/lists/musl/2026/10/21/1)

# ADR-042 — Portable application image candidates

- **Status:** Accepted for reversible Phase 18B1 packaging; no publication, deployment or release approval.
- **Owner:** HamBazi technical owner.
- **Date:** 2026-10-04.
- **Supersedes:** None. Preserves ADR-034/035 scanner policy, ADR-037/038 Web privacy and ADR-041 CI trust boundaries.

**Acceptance update (2026-10-07):** [ADR-048](048-mvp-capacity-acceptance.md)
completes 17C for MVP with performance exceptions. The original context below is
historical; production capacity/staging validation remains deferred and unproven.
Packaging decisions, security requirements and staging deferral are unchanged.

## Context

Architecture sections 19/24 require separate API/Socket, Bot, Worker and static
Web deployables with least privilege, readiness/drain and pinned compatible
versions. Phase 18A supplies quality gates but no application images. The owner
explicitly authorizes only provider-independent 18B preparation: no staging
provider, region, domain, access model, backup/PITR, RPO/RTO, retention or final
SLO may be assumed. OD-002/006/007 remain open; 17C stays Pending and mandatory
before final release readiness.

## Decision

Use one multi-stage Dockerfile with four runtime targets. Pin the official Node
24.20.0 Alpine 3.24 linux/amd64 manifest by digest. Build with the existing frozen
pnpm 12.4.1 lockfile and declared scripts. Package backend production dependencies
using `pnpm deploy --prod` and explicit `files: ["dist"]` in the eleven runtime
workspace manifests. Preserve pinned engine/state/rules/job versions; introduce
no dependency, migration, grant, contract or gameplay activation change.

Keep compiler, Prisma CLI, tests, source, npm/Corepack/Yarn and build context out
of backend runtimes. Run Node directly as UID/GID 1000, with SIGTERM and existing
loopback readiness probes. The Web target contains built public assets and a
Web-owned Node static adapter, with no runtime dependency graph. It validates
and applies the existing production browser-policy artifact to every response,
rejects symlinks/private assets/traversal and isolates health on loopback. Native
Node type stripping loads only the existing pure Web policy and SDK pin; no
general cross-module internal import is introduced.

The selected official base's OpenSSL packages initially fail the unchanged scan
threshold. Lock the official Alpine main repository's patched `libcrypto3` and
`libssl3` 3.5.9-r0 archives by HTTPS URL and SHA-256 in `base-lock.json`. Verify
their bytes before builds; install offline with APK signature verification still
enabled. Never use unsigned installation or a CVE/severity exception. This is a
reviewed runtime patch, not approval of an unscanned floating base.

Build from an owned private snapshot of tracked/nonignored candidate files,
excluding secrets and generated output with `.dockerignore`. Reject symlinks and
oversized contexts. Record source commit, dirty status, full snapshot hash,
lockfile/Dockerfile/base-lock hashes and public browser policy. Bind candidate
tags and image labels to source plus public policy; the exact manifest digest
is authoritative. Tags remain local convenience references, not a registry
immutability guarantee. Never publish. Treat dirty candidates as local review
evidence; CI rejects dirty or mismatched source identity before evidence export.

Scan all four actual local image digests with the pinned Trivy and a fresh
schema-2 database, retaining the existing High/Critical/unknown blocking policy.
Extend the existing read-only CI job with real build, scan and disposable runtime
gates. Only validated image identities, hashes, public advisories and scalar
results may enter quality evidence. No image archive, signed provenance,
application secret, raw scanner/test report or deployment credential is uploaded.

Test actual non-root images under read-only filesystems, dropped capabilities,
no-new-privileges and bounded temporary storage. Use owned PostgreSQL/Redis,
separate synthetic roles and TLS files; exercise migrations/redeployment,
authentication/profile, readiness, SIGTERM and the built Web in Chromium with
integrity-verified official SDK bytes. Backend smoke uses the explicit existing
test environment; it does not certify production TLS ingress or staging. Keep
provider-specific networking, service access, activation and recovery acceptance
in later approved work.

## Alternatives

- A distinct static-server base adds another upstream/scanner target; reuse the
  already required Node runtime and keep the adapter owned by Web.
- Shipping the entire monorepo includes development tools and unnecessary source;
  package compiled exports and production dependency closures instead.
- Selecting staging infrastructure or a secret transport now would resolve
  decisions the owner explicitly left open.
- Floating patch downloads or scanner exceptions weaken reproducibility and
  fail-closed enforcement; verify the reviewed signed package inputs instead.

## Consequences

The first supported image platform is linux/amd64. Other platforms require their
own reviewed base/archive pins and actual tests. Public policy defaults deny
unapproved API/frame origins; these candidates do not enable a playable production
deployment. Production startup keeps existing TLS and role configuration guards.
Port/health intervals are container conventions, not final hosting or SLO policy.
Build and scan require public upstream access or the same verified offline bytes.
Image signatures/provenance, immutable registry policy and staging acceptance
remain later work. Parent 18B cannot complete until its approved deployment,
rollback, restore and staging evidence exists.

## References

- [pnpm deploy](https://pnpm.io/cli/deploy)
- [pnpm Docker guidance](https://pnpm.io/docker)
- [Official Node Docker images](https://github.com/nodejs/docker-node)
- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [Docker build context](https://docs.docker.com/build/concepts/context/)
- [Packaging operations](../operations/packaging.md)

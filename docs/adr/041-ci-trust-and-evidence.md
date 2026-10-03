# ADR-041 — CI trust boundaries and immutable quality evidence

- **Status:** Accepted for reversible Phase 18A CI implementation; no deployment or release approval.
- **Owner:** HamBazi technical owner.
- **Date:** 2026-10-03.
- **Supersedes:** None. Adopts ADR-034/035 scanning and ADR-037/038 browser privacy policies in CI.

## Context

Architecture sections 16/20/24 and AGENTS require reproducible quality, contract,
security and migration checks. Phase 17B provides executable release correctness
suites; Phase 17A provides fail-closed scanner policies and a reproducible local
PostgreSQL image. The owner authorized 18A before 17C, explicitly retaining 17C as
Pending and mandatory on production-like staging before final release readiness.
Application deployment packaging and staging remain 18B work.

## Decision

Use one sequential GitHub Actions verification job on ephemeral Ubuntu 24.04 x64
runners. Check every push, pull request, merge-group candidate and manual run;
also check main weekly for advisory drift. Do not filter paths or run privileged
pull-request events. Grant only `contents: read`, remove checkout credentials,
fetch full history and pin official actions to reviewed complete commit SHAs.
Do not provide application or production credentials, environment approvals,
OIDC, registry publication, deployment or shared caches to this workflow.

Pin Node/Corepack and the manifest-selected pnpm; install with the frozen
integrity-bearing lockfile. Provision scanners and actionlint from reviewed
HTTPS archives, verifying both archive and executable hashes before execution.
Verify official Telegram SDK bytes against the existing public integrity pin.
Install PostgreSQL 18 tools from the signed official PGDG Ubuntu repository on
ephemeral runners only. Select Docker 29.8.1 with its containerd image store to
reproduce the already-reviewed local service image. No product policy changes.

Force Turbo execution without remote/shared caches. Build public surfaces before
CLI/fixture consumers, with one Turbo task at a time so compiler
probes retain their existing deadlines on bounded hosted CPUs. Run
declared quality scripts, executable contract checks,
generate/format/diff contracts, Bot integration, uncached dependency/secret/image
scans, isolated real-service migration/fault/restore/release-browser checks and
the ordinary/SDK/preview browser suites. Check contracts before regeneration so
regeneration cannot bless stale or incompatible public contracts. Restore the
normal production Web build after explicit loopback browser policies.

Capture child gate output only in bounded private memory. Print fixed gate names,
pass/fail status, numeric summaries and validated public advisory identities; do not export raw assertions, connection
diagnostics, recipient views, reports, traces, videos or screenshots. Failure,
timeout, malformed evidence, scanner unavailability or cleanup errors fail the
job. Negative CLI and privacy checks prove representative failures cannot reach
evidence generation. Worktree changes after generation also block evidence.

Successful non-PR main runs upload only a content-free JSON manifest, named by
commit SHA, run ID and attempt, without overwrite and with a 14-day CI evidence
retention. Bind source commit/tree, lockfile/schema/tool policy hashes, compiled
application/public contract file hashes and passed gate counts. Reject dirty
source, source-ref mismatch, symlinked build files and loopback Web policy.
Always set `productionReleaseApproved: false`, and record 7C/17C/18B/19 statuses.
This is build metadata, not signed provenance, a deployable archive, a release
attestation or permission to promote an untrusted pull-request artifact.

Repository administrators must enable and verify required branch/ruleset checks
after publication. The exact workflow/check and protected-release requirements
are documented in the [CI guide](../operations/ci.md). The workflow cannot modify
GitHub repository settings with its read-only permissions. Staged E2E will be a
separate protected gate after 18B supplies the environment; local fixture success
does not replace that evidence or deferred 17C.

## Alternatives

- Shared caches shorten builds but increase cross-trust contamination and can
  conceal skipped gates; defer optimization until evidence justifies it.
- Raw test reports and browser captures aid debugging but can disclose tokens,
  chat or hidden game information; retain safe counts and fixed failure stages.
- Automatic deployment from CI would cross the authorization boundary and lack
  the approved hosting, backup and release policies.
- A green placeholder staging check would misstate unavailable evidence.
- Uploading broad workspace/build archives would require a separate reviewed
  deployable inventory and privacy policy under 18B.

## Consequences

Runs require public registry/advisory/tool access, Docker and browser resources.
Failures provide less diagnostic detail; reproduce in an owned local fixture
and inspect safe evidence rather than enabling raw debug uploads. Dependency
and runner tool updates remain reviewed changes with fresh compatibility scans.
Action pinning and hashes reduce substitution risk but do not remove upstream
trust. Review workflow, policy and scanner changes as security-sensitive code.
Hosted run and repository-setting evidence must be recorded after owner-led
publication; implementation/local validation alone does not prove activation.
17C remains Pending, with approved peak/provider/SLO decisions still required.
No session, quota, chat retention, backup retention, production host or launch
decision is resolved here.

## References

- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub Ubuntu 24.04 runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
- [Official Docker setup action](https://github.com/docker/setup-docker-action)
- [Official PostgreSQL Ubuntu packages](https://www.postgresql.org/download/linux/ubuntu/)
- [actionlint releases](https://github.com/rhysd/actionlint/releases/tag/v1.7.12)

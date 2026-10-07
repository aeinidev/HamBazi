# ADR-043: Portable application deployment and rollback preparation

- **Status:** Accepted for Phase 18B2 portable preparation and disposable rehearsal only
- **Owner:** HamBazi owner / Backend and Operations maintainers
- **Date:** 2026-10-04

**Acceptance update (2026-10-07):** [ADR-048](048-mvp-capacity-acceptance.md)
completes 17C for MVP with explicit performance exceptions. Production-like
capacity/reconnect/soak validation remains deferred; no actual staging/recovery
gate or operating decision in this ADR is waived.

## Context

ADR-042 provides reviewed local API/Bot/Worker/Web candidates. The owner approved
18B2 while explicitly deferring provider-specific provisioning/activation. OD-002,
OD-006 and OD-007 remain open. Architecture sections 22–25 require separate
least-privilege credentials, private data services, compatible migrations/jobs,
readiness before admission and application rollback that preserves durable truth.

## Decision

1. Prepare an application-only Docker Compose definition. It publishes no ports,
   creates no data service/volume/ingress/network and selects no provider. Supplied
   existing bridge networks separate private connectivity from Bot egress. The
   private network must actually be internal. Explicit private IPv4 addresses
   support the existing Bot private-IP verifier and peer allowlist; they are
   operator inputs, not an approved staging topology or access model.
2. Bind each role to its exact scanned candidate digest, UID/GID 1000, read-only
   root, dropped capabilities, no-new-privileges, bounded noexec tmpfs and SIGTERM.
   No automatic restart or raw container logging is selected in this preparation.
   Supervisor/telemetry routing and controlled ingress remain staging decisions.
3. Supply four separate private literal `KEY=value` files using Compose's raw
   env-file mode. Preparation rejects cross-role/unknown variables and applies the
   existing public production config parsers. It verifies separate DB/Redis
   identities, Bot service-key agreement, private addresses, TLS key/cert identity
   and explicit stop grace exceeding existing process drain/report/exit budgets.
   No quota, lifetime, origin or final SLO value is invented. TLS files are mounted
   individually and read-only; role files are never mounted inside containers.
4. The preparation CLI performs read-only network inspection and Compose config
   validation. It creates exclusive private output outside the checkout, emits
   only scalar success, and never starts, pushes, deploys or migrates services.
   Evidence binds inventory/scan/definition hashes. Checkout migration/permission/
   contract fingerprints aid review; they do not establish compatibility with an
   arbitrary image source. Compatibility, active pins, queued jobs and production
   release approval remain explicitly false pending a reviewed release pair.
5. Preserve expand → migrate/backfill → contract with at least one release overlap.
   Deploy migrations/grants through the existing database-owned command in a
   separate approved operator context; runtime roles get no migrator credential.
   Application rollback retains expansion and original durable commands/events/
   results/receipts. It never resets, applies destructive down SQL, blanket-replays
   jobs or restores a database as an incidental image rollback.

## Alternatives

- A bundled data/ingress stack would silently choose hosting/access and backup
  behavior. Keep those systems outside this portable application definition.
- Compose interpolation or shared credential files could grant another role's
  authority or transform literal signing keys. Validate role-specific raw files.
- Automatic blue/green traffic changes, mutable tags and database down-migrations
  would exceed this authorization and could break active Matches or job recovery.

## Consequences

This is an amd64 Docker/Compose preparation path with explicit IPv4 peer inventory,
not orchestration for all providers or a finalized network/secret-store design.
Docker/network inspection does not prove external firewall, TLS ingress, DNS
privacy, managed database grants or egress policy. Certificates currently use a
single directly verifying API issuer/trust certificate; a provider chain must be
reviewed and rehearsed before activation. Host TLS keys must be readable only by
the intended runtime UID. Secret rotation/secure storage and permission checks
are still operator responsibilities; raw env values are visible to authorized
Docker administrators and must never be exported with `compose config`/inspect.

Disposable verification runs the generated production Web definition and a
separate backend test-profile image replacement/rollback rehearsal. That pair
has unchanged product code/schema/protocols; it does not prove compatibility of
a future engine or consumer change. Actual staging deployment, migrations,
rollback, provider/PITR restore, approved RPO/RTO/retention/SLOs, 7C activation,
17C capacity/reconnect/soak and Phase 19 release readiness remain gates.

# ADR-053: Bounded advisory-age exception for personal staging

- Status: Accepted by explicit owner reply, 2026-10-08
- Owner: HamBazi sole owner/operator
- Date: 2026-10-08
- Related: ADR-034, ADR-050, ADR-052

## Context

Official Trivy DB publication failed at Docker Hub organization login. Fresh
empty-cache mirror and GHCR downloads return the same actual update from
2026-10-07 07:38:55 UTC. The owner explicitly selected a 48-hour maximum for only
this owner-only staging, with a hard expiry at 2026-10-09 11:08:55 Tehran.

## Decision

Keep the ordinary CI/scanner policy at 24 hours. An explicit release-only profile
may accept actual advisory/download ages up to 48 hours on `185.110.191.104`,
Docker daemon `342f251a-9e56-4353-af12-a32429b7a2e7`, with the complete fail-closed
owner policy. The profile expires at `2026-10-09T07:38:55.515Z`. Preparation records
the actual timestamps, approval hash, exception and failed ordinary 24-hour gate.
No environment override, timestamp rewrite or implicit CI waiver exists.

Continue attempts to obtain official fresh advisories. Scan the actual immutable
application/data/ingress/ACME artifacts; High, Critical and Unknown findings and
all secrets still block. Preserve failed and historical evidence. An expired or
foreign-target profile cannot prepare or start a new release.

## Alternatives

- Wait indefinitely for publication: contrary to the accepted bounded test scope.
- Global age change, suppressed findings or rewritten metadata: not authorized.

## Consequences

New advisories published during the exception may be absent. This risk is accepted
only for disposable owner-only testing, never public/production readiness.
Recheck normal fresh evidence when publication recovers and at final review.
This exception is not a passed normal freshness gate or full phase acceptance.

# ADR-051: Bounded private preparation and manual operator observation

- Status: Accepted for bounded personal-staging preparation only; activation remains unapproved
- Owner: HamBazi project owner / sole operator
- Date: 2026-10-08
- Related: ADR-034, ADR-039, ADR-043, ADR-049, ADR-050
- Supersedes: ADR-043's disabled logging/export choice only when the explicit private operator profile is supplied

## Context

The owner authorized installing Node 24.20.0/pnpm 12.4.1, creating the two reviewed
networks, preparing private role files/certificates, privately transferring the exact
existing candidates and running preparation. The owner explicitly requested a focused
manual-monitoring repair without weakening privacy or validation. Application activation,
migrations, Telegram changes, paid resources and unrelated phase work remain excluded.

## Decision

1. Use `hambazi-staging-private`, internal `10.89.18.0/24`, and the separate bridge
   `hambazi-staging-bot-egress`, `10.89.19.0/24`. Recheck conflicts immediately before
   creation. API/Bot/Worker/Web use `.10/.11/.12/.13` in the private subnet. Separate
   same-VPS PostgreSQL/Redis credentials and verified TLS, API/Worker pools 5/3,
   connection ceiling 32 and 45-second stop grace are supplied owner decisions.
   Private preparation files belong under `/opt/hambazi-staging/private`.
2. Add optional `operatorMonitoring=private-manual-v1` to the portable schema.
   Require existing API/Bot/Worker metrics flags to be true for this profile, and
   retain disabled-export validation without the profile. Metrics remain on the
   unchanged exact-GET container-loopback listener; no public port, proxy, collector,
   external reporter or product capability is enabled.
3. Select the Docker `local` driver only for that profile, with `max-size=10m`,
   `max-file=3` and compression. This bounds local log rotation by size/count, not
   time or guaranteed observability history. It is not a backup. Do not select
   environment/label enrichment, change the daemon default or add another archive.
   Only existing allowlisted application telemetry may contain gameplay correlation;
   raw content/secrets/hidden state remain forbidden.
4. Provide a read-only operator CLI for already-running reviewed containers.
   It verifies private prepared-definition hashes and selected image/user/logging/
   unpublished-port identity, executes existing loopback probes inside the container,
   and projects safe log fields/fixed metric dimensions. Unknown crash output is
   omitted; errors never echo role files, environments, commands or original causes.
   Output is timestamped, bounded and not automatically persisted. SSH/root Docker
   access is the owner's existing private operator context, not activated product
   Admin authority. The CLI cannot start, reset, migrate or control applications.
5. For private data TLS, optionally supply `tlsFiles.dataCa` and the fixed
   `NODE_EXTRA_CA_CERTS=/run/hambazi/tls/data-ca.pem` in both API/Worker files.
   Require both fixed references, a currently valid CA certificate and PostgreSQL
   `sslmode=verify-full`; Redis retains `rediss://`. Mount the CA read-only into
   those roles only. No arbitrary Node options or trust path are accepted. Separate
   internal-service and data issuers/leaves are prepared privately. Key/certificate/
   SAN/chain checks are not proof of actual service handshakes or least-privilege grants.
6. Generate independent credentials privately through CSPRNG. The real development
   Bot token must come from an owner-supplied private reference; never substitute
   a synthetic token or request its contents in chat. Pinned runner installation,
   image/archive/source-label identity and unchanged 24-hour scan freshness require
   actual evidence. Preserve the original `65ff180` candidate/inventory/scan.
7. Other previously proposed ports, ingress peer, quotas, timeout/cleanup budgets
   and binding identifiers are not included in the numeric approval above. Keep
   them proposed until explicitly supplied/accepted; fixture acceptance is insufficient.
   The Main Mini App Room-invitation gap remains recorded and outside this work.

## Alternatives

- Keep logging/export disabled: fails the selected manual operating model.
- Publish metrics or add hosted logging: expands scope and exposes operational signals.
- Accept arbitrary Node/TLS options or fake a Bot credential: weakens the preparation gate.

## Consequences

Portable defaults remain unchanged. The explicit private profile provides a reviewable
observation path for later authorized activation. Local synthetic outage/privacy checks
do not prove staging monitoring coverage. Preparation never starts data/application
services or runs migrations. Actual deployment/TLS ingress/role grants/rollback/7C gates
remain separate. ADR-050 recovery evidence remains excluded, unperformed and not passed.

## References

- [Deployment preparation](../operations/deployment.md)
- [Operating decisions](../operations/staging-operating-decisions.md)
- [Private operator procedure](../operations/runbooks/private-operator.md)
- [Docker local driver and rotation](https://docs.docker.com/engine/logging/drivers/local/)
- [pnpm pinned runner installation](https://pnpm.io/installation)

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
7. The owner's subsequent 2026-10-08 follow-up explicitly accepts the latest report's
   proposed public profile, including its linked 44-field review artifact. Ports,
   ingress peer, quotas, timeout/cleanup budgets and binding identifiers are now
   supplied decisions for this preparation only; fixture acceptance is not their
   approval source. The accepted profile is recorded below. The Main Mini App
   Room-invitation gap remains recorded and outside this work.

## Accepted public role profile and actual follow-up

The owner supplied a private laptop reference for the development Bot and authorized
read-only `getMe` verification, completion of real role files and preparation in a new
private output. Preserve the earlier failed `prepared-20261008-01` evidence.

| Scope                                    | Accepted values                                                                                                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API ports, ingress and operations        | HTTP/health/private Bot TLS `8080/8081/9443`; trusted ingress peer `10.89.18.2`; probe `1000 ms`; drain `15000 ms`; API/Worker pools `5/3`; all-role stop grace `45 s`                                           |
| Auth binding and existing session policy | Active key ID `staging-auth-20261008`; issuer `hambazi:personal-staging`; audience `hambazi:personal-mini-app`; retain ADR-014 session/max-age/future-skew `900/300/30 s` and issuance limits `30/6`             |
| API quotas                               | Profile read/write `60/10`, catalog read `60`; HTTP/Engine/connect/event admission per minute `300/60/10/120`; HTTP/Engine in-flight `8/8`; connections `32`; pending per socket/total `4/32`; subscriptions `8` |
| Internal Bot binding and quotas          | Key ID `staging-bot-20261008`; allowed peer `10.89.18.11`; request/identity limits `60/10`; onboarding lease `15000 ms`; Bot API origin `https://10.89.18.10:9443`                                               |
| Bot operations                           | HTTPS/health `9444/8082`; backend/send timeout `1000/1000 ms`; onboarding lease `15000 ms`; in-flight `4`; probe `1000 ms`; drain `30000 ms`                                                                     |
| Worker operations                        | Namespace `hambazi_staging_personal`; cleanup interval/batch/attempts/backoff `60000 ms/10/3/1000 ms`; health `8083`; probe `1000 ms`; drain `15000 ms`                                                          |
| Web, trust and observation               | HTTP/health `8080/8081`; exact approved Web/API origins and Main URL; API/Bot/Worker private metrics enabled; matched API/Worker data-CA mounts; bounded private logging from this ADR                           |

The existing proposed same-VPS aliases become role URL references
`postgres-staging:5432/hambazi` and `redis-staging:6379/0`, with fixed separate
API/Worker identities, independent generated passwords, `verify-full`/`rediss` and
the prepared matching DNS SANs. This creates no service, database, grant or TLS
handshake evidence. All binds, trust paths and network/IP values use the reviewed
portable schema; no additional policy value is needed to run preparation.

At `2026-10-07T22:12:17Z`, the verified-HTTPS `getMe` response matched the expected
Bot username, Bot identity and token ID. It also reported `has_main_web_app=true`;
this verifies presence, not the configured URL, webhook, mobile flow or Room links.
Direct laptop DNS returned a local blocked Telegram address; the existing laptop
HTTPS proxy succeeded with certificate validation and redirects disabled. VPS direct
HTTPS was separately reachable. No token or raw API response is retained in evidence.

Real API/Bot/Worker/Web files were created exclusively, mode 0600, using the supplied
Bot and existing independent generated credentials. Real public parsers and unchanged
inventory/24-hour freshness gates passed. The target daemon and all four exact image
source/build/non-root labels match. `prepare.mjs` exited zero at
`2026-10-07T22:13:30Z`, creating `/opt/hambazi-staging/private/prepared-20261008-02`
mode 0700 with mode-0600 Compose/evidence files. Prepared-definition checks verify
hashes, role separation, hardening, no published ports, bounded logging/metrics,
read-only data trust, 45-second grace and no embedded secret values.

Retained scan identities are unchanged: zero High/Critical/Unknown and one Moderate
finding per application image. The advisory database was 14.58 hours old at this
check; its earliest 24-hour expiry is `2026-10-08T07:38:55.515Z`. This is freshness
revalidation, not a new scan. Private safe evidence and accepted-profile references
are retained in the existing laptop/VPS evidence directories. Services remain inactive;
migrations, public TLS issuance, Telegram changes, real data TLS/grants, monitoring
activation and release compatibility acceptance remain unperformed. Preparation
success does not complete 18B3, authorize activation or pass ADR-050 recovery gates.

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
- [Telegram getMe identity check](https://core.telegram.org/bots/api#getme)

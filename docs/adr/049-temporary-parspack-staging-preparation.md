# ADR-049: Temporary ParsPack staging host and origins

- Status: Accepted for owner-confirmed temporary 18B3 preparation; operational policies and remote execution remain separately gated
- Owner: HamBazi project owner; named release, security and recovery operators remain unassigned
- Date: 2026-10-07
- Related: ADR-038, ADR-039, ADR-041, ADR-042, ADR-043, ADR-045, ADR-046, ADR-048

**Owner decision update (2026-10-08):** [ADR-050](050-disposable-personal-staging-exception.md)
records the project owner as sole operator/tester/secrets owner/responder,
disposable synthetic personal staging, no backup/PITR/WAL archiving/offsite
storage, manual monitoring and Main Mini App direction. It supersedes the
unresolved temporary ownership/recovery/monitoring statements below. Real private
references, TLS, compatibility and activation evidence remain separate gates.

## Context

Phase 18B3 requires real staging evidence and approved operating decisions.
The owner supplied an existing temporary test VPS, staging origins, development
Bot identity and DNS records. These confirmations resolve the temporary host and
origin inputs; they do not select production hosting or answer the remaining
access, data-service, recovery, monitoring and activation questions.

The owner subsequently authorized local project/development read/write work,
dependency remediation, builds/scans, disposable database migrations and local
Git commits. That supersedes the conversation's earlier repository read-only
restriction. It supplies no production publication, destructive production
operation, live Telegram change or external production mutation approval.

## Decision

Use the existing ParsPack Germany test host `185.110.191.104` for the explicitly
approved temporary staging target. Read-only checks verified Ubuntu 24.04.5 LTS
amd64, four logical CPUs, approximately 3.8 GiB RAM, no swap, approximately
36 GiB free disk, active Docker Engine 29.8.2 and Compose v5.6.0. These observed
resources are not a production capacity certificate or a revised workload target.

The owner-approved public inputs are:

| Purpose            | Approved value                                                      |
| ------------------ | ------------------------------------------------------------------- |
| Web                | `https://staging.hambazi.top`                                       |
| API / WSS          | `https://api-staging.hambazi.top` / `wss://api-staging.hambazi.top` |
| Bot webhook origin | `https://bot-staging.hambazi.top`                                   |
| Development Bot    | `@Hambazidev_bot`                                                   |
| DNS management     | Owner-managed ParsPack, DNS-only A records to `185.110.191.104`     |
| Parent delegation  | `tornado.parspack.net`, `rainbow.parspack.net`                      |

The repository's webhook route is `POST /v1/telegram/webhook`; the future exact
URL is `https://bot-staging.hambazi.top/v1/telegram/webhook`. Preserve HTTPS,
secret-header validation, rate limits and update deduplication. Its ingress must
respect the existing rejection of forwarded headers; origin approval does not
authorize webhook registration or a proxy trust-policy change.

Recheck parent/authoritative/public DNS before future TLS and usable staging
acceptance. Do not change DNS records to work around stale recursive caches.
Retain failed DNS observations alongside subsequent successes.

Local immutable candidates may use these exact Web/API origins. Keep existing
deny-by-default framing until exact Telegram Web ancestor origins are approved;
fixture origins and a proposed Mini App short name are not approvals. No real
role file, TLS certificate, secret, private subnet or operating quota is inferred.

Proceed with local 18B3 remediation and preparation. Before remote provisioning,
publication, migration, deployment, TLS or Telegram operations, establish the
applicable approved policies and bounded execution scope in the
[operating worksheet](../operations/staging-operating-decisions.md). Preserve
7C before gameplay/admin activation. This ADR enables no runtime capability.

## Alternatives

- Continue describing the confirmed host/origins as unknown: loses actual owner inputs.
- Treat them as complete operational or production approval: exceeds the supplied scope.
- Promote local fixtures into access/recovery policy: provides no owner decision or staging evidence.

## Consequences

Temporary hosting/origin preparation can continue without repeating those
questions. Private data-service topology, operators, access/secrets/TLS renewal,
release/rollback compatibility, OD-006 and remaining OD-007 remain unresolved.
Accepted capacity and normal-load targets remain unchanged; ADR-048's MVP
performance exceptions do not prove production SLOs, faults or two-hour soak.
Local scans and rehearsals cannot complete 18B3 or authorize production release.

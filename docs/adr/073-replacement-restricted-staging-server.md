# ADR-073: Replacement restricted staging server

- Status: Accepted within the owner's explicit migration request
- Owner: HamBazi project owner / staging operator
- Date: 2026-10-20

## Context

The owner requested migration to 89.46.217.9, confirmed the previous server is
permanently unavailable, and authorized using local source, configuration and
available backups. No recoverable database dump from that server was found.
The owner supplied both Telegram admission identities and changed the three
staging DNS records. Documents and previous acceptance reports provide project
constraints and historical evidence; they do not establish recoverability or
acceptance on the new server.

## Decision

Deploy the existing local application, including the owner's uncommitted changes,
as isolated snapshot `e86843ee62fd65ff080da0383c78c662763689f7`. Preserve the original
working tree and separate the replacement operations files from that image source.
Initialize a fresh PostgreSQL database with the existing migrations and scoped
Kahroba metadata. Do not represent previous users, matches or sessions as restored.

Retain restricted staging admission for exactly the supplied owner and tester.
Keep public admission and production release disabled. This is a temporary
replacement target; it does not finalize provider/region, capacity, retention,
backup/PITR or production SLO decisions.

Run four pinned application images and pinned PostgreSQL/Redis on private Docker
networks with separate least-privilege credentials and verified data/service TLS.
Use host-managed Ubuntu nginx and Certbot for public ingress and ACME. This
replaces the old ingress/ACME containers; the active image inventory is six,
while the host package versions are explicitly bound in the private control.
Retain restrictive routes, browser policy and authenticated Telegram webhook.

Carry forward the normal hourly renewal policy of ADR-069, bound to this new
daemon, container/image identities, configuration, host packages and two-account
admission. Use fresh official vulnerability data and the existing severity gate.
Each expiry is at most the earlier genuine advisory update/download timestamp
plus 24 hours. A repeated download alone cannot extend it. Failed renewal retains
the installed finite expiry. Containment closes ingress and drains the four
applications while preserving data services. Renewal never starts applications
or reopens ingress. Do not copy the old host's timer bindings or expired advisory
outage exception.

Record failed and pending checks honestly. In particular, destination Telegram
outbound is unavailable; a healthy Bot process does not establish message delivery
or real two-player acceptance.

## Alternatives

- Waiting for the old server cannot recover its data because the owner confirmed
  it is gone. Treating local development data or backup metadata as the old live
  database would invent recovery evidence.
- Reusing old credentials and expiry bindings would couple the new deployment to
  stale host identities and inaccessible services.
- Opening public admission, disabling expiry, or bypassing TLS would broaden the
  requested migration and violate existing staging constraints.

## Consequences

The application can be used on the same HTTPS staging origins with a new durable
database. Previous history remains unavailable. Telegram replies require a working
destination egress path; native two-account gameplay must still be observed.
Changes to pinned containers, configuration, certificates or host package versions
require renewed review and control rebinding. The deployment report and runbook
record current evidence and remaining limitations. Earlier production HOLD and
architecture decisions remain in force.

See [deployment evidence](../operations/replacement-server-20261020.md) and
[operator instructions](../../infra/docker/server/README.md).

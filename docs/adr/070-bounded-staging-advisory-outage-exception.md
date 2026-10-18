# ADR-070: Bounded exception during upstream advisory build outage

- Status: Accepted by explicit owner reply on 2026-10-17; activation requires the recorded bounded checks
- Owner: HamBazi project owner / sole staging operator
- Date: 2026-10-17
- Supersedes: None. ADR-069 normal automatic renewal and the default 24-hour gate remain unchanged.

## Context

Normal automatic renewal advanced the staging expiry repeatedly through
2026-10-17 01:13:54 UTC. Subsequent official downloads returned the same database
updated at `2026-10-16T01:13:54.947090392Z`; re-downloading cannot renew its age.
The official Trivy DB builds on October 16/17 failed. GHCR, Docker Hub and the
default mirror supply the same expired metadata. Normal containment therefore
closed ingress and gracefully stopped the applications at the approved expiry.

The owner has asked to restore service. Existing authorization covers normal
renewal until revoked; it does not authorize accepting older advisory evidence.
The earlier ADR-053 exception expired and is not being reused or extended.

## Decision accepted by the owner

For the unchanged restricted staging VPS `185.110.191.104`, daemon
`342f251a-9e56-4353-af12-a32429b7a2e7`, existing eight exact images and same
owner plus one numeric tester only, permit actual advisory/download age up to
**48 hours**, with a non-extendable hard deadline of **2026-10-18 01:13:54 UTC /
04:43:54 Tehran**. Recheck all image finding gates, target identity, exact image
IDs, admission and role/service/Compose/route hashes before execution.

Record normal-24-hour failure and the actual unmodified metadata in a separate
private exception approval/activation binding. Do not change the global policy,
existing automatic-renewal code, severity thresholds or advisory timestamps.
High, Critical, Unknown and secret findings continue to block. Preserve expiry
enforcement, admission, production HOLD and durable data. Start only the existing
four app containers under maintenance; verify readiness before restoring the
reviewed restricted routes. Keep all original preparations and prior evidence.

Continue normal automatic renewal attempts. If genuine fresh official evidence
returns, the original normal gate may advance the deadline and resume ordinary
renewal. Otherwise the unchanged containment service must stop the apps at this
hard deadline. No automatic repeated exception or later extension is authorized.

## Alternatives

- Retain maintenance until genuine normal-fresh advisories are available.
- Disable expiry, rewrite timestamps or silently change the global age limit:
  violates the preserved security controls and is not proposed.

## Consequences

New vulnerability disclosures after the last successful official build may be
missing. The owner explicitly accepted that bounded risk for the two-human
staging scope. This does not certify a normal freshness pass, public access,
production readiness or native Telegram acceptance. The exception is neither
perpetual nor automatically renewed.

## Evidence

See [the incident investigation](../operations/incidents/2026-10-17-upstream-advisory-outage.md)
and the [failed official DB build](https://github.com/aquasecurity/trivy-db/actions/runs/39031246212).

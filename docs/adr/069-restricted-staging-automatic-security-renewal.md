# ADR-069: Automatic normal renewal for restricted staging

- Status: Accepted by explicit owner instruction
- Context: The owner requested automatic renewal until personally revoking it after two verified scheduled containment outages.
- Decision: Run a separate hourly eight-image normal security renewal, distinct from the two-image TLS renewal. Fresh official advisories and unchanged exact images, two-human admission, private ports, role/route/service/Compose controls and healthy services are mandatory. Advance only the hard containment date, to the earlier genuine metadata timestamp plus 24 hours rounded down. Unchanged advisories do not extend the date. Failed checks keep the existing expiry. No app startup, deployment or ingress reopening is automated.
- Alternatives: Manual daily renewal caused repeated planned outages; disabling expiry or accepting stale evidence breaks the security gate; perpetual restart/reopening would override maintenance and deployment controls.
- Consequences: Authorization continues until revocation, while each installed security deadline remains finite. Expiry still contains service if scans, controls or health cannot be renewed. A deployment changing the bound images/controls requires separately reviewed rebinding. Stop by revoking the private control first, disabling the hourly timer and stopping any in-flight service; preserve the containment timer.
- Owner: HamBazi project owner / sole staging operator
- Date: 2026-10-13
- Supersedes: Per-renewal approval for unchanged normal restricted staging only. Existing production HOLD, security freshness, admission and containment requirements remain.

Implementation and revocation are documented in [the operating runbook](../operations/runbooks/staging-auto-renewal.md).

# ADR-071: Ingress-only libexpat security remediation

- Status: Accepted for the owner's existing restricted staging restoration request
- Owner: HamBazi project owner / sole staging operator
- Date: 2026-10-18
- Supersedes: None; ADR-069 normal renewal and production HOLD remain

## Context

The bounded advisory-age exception expired on October 18. Official fresh
advisories returned, revealing High `CVE-2026-77214` in the existing ingress
image's `libexpat 2.8.5-r0`. Automatic renewal correctly refused this image.
The other seven selected images pass. Reopening the vulnerable ingress or
relaxing the severity gate would violate the preserved controls.

## Decision

Build a clean ingress-only candidate from the exact retained ingress image,
installing only signed Alpine `libexpat 2.9.0-r0` offline. Pin its official APK
URL and SHA-256 in the component lock. Preserve the original Nginx executable,
runtime arguments, routes, ports, networks, read-only mounts, UID and hardening.
Use the existing packager with an additive explicit role subset; its original
two-component default remains unchanged. Source commit for the deployed ingress
candidate is `45aa21af1f40f5e9cb249019f459536c23fbc6c6`.

Record source provenance per image so the retained ACME component keeps its
original commit. The TLS renewal checker accepts additive per-image commits,
falling back to the existing inventory-level commit for legacy inventories.
An installed adapter changes only its scanner import location; it does not
modify the immutable old runner or run certificate issuance during recovery.

Scan the patched ingress and seven retained images with fresh official data
under the unchanged normal 24-hour/High/Critical/Unknown gates. Replace only
ingress under maintenance, rebind the hourly job to its new exact image/ID,
then start the same application containers and reopen reviewed restricted routes
after health and preservation checks. Keep owner plus one tester and production
isolation. No application feature, schema, game pin, database or credential change.

## Alternatives

- Extend the old exception or suppress the High finding: does not remediate the
  discovered vulnerable library and is not authorized.
- Rebuild every app/component or upgrade Nginx itself: unnecessary scope and
  compatibility risk for a one-library ingress defect.
- Reconstruct the old full OS patch set from changing package archives: broader
  inputs than the exact retained image plus the single signed fixed package.

## Consequences

The retained private base image must remain available to reproduce this targeted
candidate; this is a restricted staging artifact, not a public hosted-CI or
production release. Both image and APK digests remain explicit. The old ingress
image is retained as provenance/build input but is not a security-approved public
rollback. Any fallback to it must remain under maintenance and be rescanned.

Normal automatic renewal resumes only with the newly scanned exact binding.
The expired 48-hour exception is not renewed. Existing preparation records,
component inventories and supervisor configuration backups are preserved.

See [the incident and verification report](../operations/incidents/2026-10-18-ingress-expat-remediation.md).

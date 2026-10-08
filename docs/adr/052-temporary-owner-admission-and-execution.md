# ADR-052: Temporary owner-only staging execution

- Status: Accepted for the owner's bounded temporary-staging deployment request
- Owner: HamBazi project owner / sole operator
- Date: 2026-10-08
- Related: ADR-014, ADR-034, ADR-039, ADR-049, ADR-050, ADR-051

## Context

The owner explicitly supersedes preparation-only restrictions for admission/security
remediation, private data startup, compatible migration, ordered application startup,
public TLS/firewall and verified owner-only Web/Auth. Gameplay, Admin, Room invites,
Telegram settings, production and destructive migrations remain excluded. The
current candidate has no owner admission. The proposed Caddy artifact cannot pass
the existing module-level scan because GO-2026-5932 has no fixed module version.

## Decision

Use explicit `telegram-owner-only-v1` plus a private fixed admission reference for
API and Bot. The strict file contains exactly one privately enrolled Telegram ID.
Auth checks the signed Telegram identity before account/session/receipt effects;
session authentication/logout and Bot delivery also check current admission.
Users eligibility uses the existing public Users port, never a foreign repository.
Missing/invalid/unlinked/open-permission policy denies; selected profile never falls
back. Native Telegram framing and ordinary session policy remain unchanged.

Preparation binds the private reference for both roles and rejects partial profile
selection. Preserve the historical `prepared-20261008-02`; build/scan new clean
candidates and create a new private prepared output. Personal IDs, tokens, raw
initData and environment files stay outside Git/telemetry. Redis rate-limit metadata
is ephemeral; non-owner attempts produce no account/session/onboarding writes.

Select Nginx stable 1.30.5 with a separate one-shot Certbot 5.8.0 HTTP-01 client.
Patch their actual affected OS/Python dependencies with signed Alpine packages
and hash-pinned PyPI wheels; remove the unused package installer binaries from the
ACME runtime. Use exact reviewed image digests/provenance, not mutable tags.
Extend only the scanner's pinned artifact grammar for clean-source
`hambazi-staging/ingress` and `hambazi-staging/acme` images; all report/schema,
High/Critical/Unknown, zero-secret and 24-hour freshness rules stay unchanged.
Caddy's failed evidence is preserved, not suppressed or reclassified.

The latest plan's proposed data/IP/resource/bootstrap/migration/firewall values
are now authorized for this target. Preserve SSH and verify a second connection;
start ingress in maintenance, validate containment and owner/non-owner boundaries
before opening only Web/Auth. A private non-mutating profile read needed by the
existing authenticated shell remains subject to the same owner session authority;
no new product mutation/game/Admin route is enabled. Free ACME uses private account
state and HTTP-01; scheduled renewal must refresh required scanner evidence and
cannot run a failed/stale ACME artifact. Renewal does not alter DNS or Telegram.

## Alternatives

- Suppress/reclassify the Caddy finding: violates the unchanged scan gate.
- Trust CORS/IP/the first visitor: does not establish server-verified owner identity.
- Share Admin/player authority or enable games through SQL: violates 7C.
- Reset data on migration/rollback failure: outside the bounded authorization.

## Consequences

Public bootstrap assets contain no private identity/data; protected account/session
functionality is owner-only. Actual native-client confirmation remains separately
identified from synthetic signed protocol smoke. New schema/grants are not required
by admission. Real TLS/grants/compatibility/health/containment and fresh scans must
pass before traffic. A compatible scanned previous release is still missing;
maintenance containment cannot count as version rollback acceptance. ADR-050's
recovery omission stays excluded/unperformed, never passed. Full 18B3/game/7C
acceptance and other phases are not inferred from this restricted deployment.

## References

- [Go advisory](https://vuln.go.dev/ID/GO-2026-5932.json)
- [Nginx stable releases](https://nginx.org/en/download.html)
- [Certbot 5.8.0](https://github.com/certbot/certbot/releases/tag/v5.8.0)

# ADR 076: Kahroba entry in the main lobby

- Status: Accepted
- Owner: HamBazi owner
- Date: 2026-10-23
- Supersedes: ADR 075 exclusion of main-lobby card activation for the admitted staging cohort

## Context

The owner explicitly requested deployment of the palace lobby, activation of Kahroba in the main HamBazi lobby and removal of the separate “میز خصوصی کهربا” entry.

## Decision

Use the existing Kahroba artwork/card as the single main-lobby entry. The authenticated availability response advertises AVAILABLE only when the Kahroba runtime, routes and admission are installed and enabled, and the authenticated identity passes the existing admission policy. Coup pause and other games' availability remain independent. The existing Kahroba route and invitation links stay compatible. Both admitted frontend gateways use WebSocket-only transport, matching the current ingress. Kahroba must not begin with Socket.IO polling: ingress rejects its polling POST and WebKit reports transport errors. The generic unscoped transport is unchanged. Remove the floating private-entry link and its style.

Deploy the tested source to the currently bound replacement staging server through immutable candidate images, fresh exact-image qualification, maintenance/drain, preserved previous application pins/data, private readiness and renewed control bindings. Preserve the existing database, credentials, admission cohort and Bot gateway. This authorizes the requested staging deployment and card visibility; it does not silently enroll new identities or claim production/load acceptance.

## Alternatives

Keeping both entries duplicates navigation. Enabling the card only in the browser would conceal unavailable or unauthorized server access. Globally widening admission is unnecessary for the requested main-lobby entry.

## Consequences

No database migration, engine pin change or public contract shape change is required. The same user-visible game now opens through its main card. Existing admitted identities can use private/public 2/3/4-seat flows; three/four-human play on this server still needs the corresponding legitimately admitted identities. Deployment evidence is recorded separately from local test evidence.

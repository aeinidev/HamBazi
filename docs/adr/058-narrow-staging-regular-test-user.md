# ADR-058: One verified regular staging test user

- Status: Accepted for the owner's explicit bounded staging test request
- Owner: HamBazi project owner / sole staging operator
- Date: 2026-10-09
- Supersedes: ADR-052/054/056/057's single-owner product admission only for this explicitly authorized ordinary account; all other staging and production gates remain

## Context

The owner explicitly authorizes Telegram account `@devtest98` to test ordinary
registration, profile, Mini App entry, the existing personal game against server
bots and support. Public access remains disabled. The owner/admin and support
destination must not change. A mutable username cannot be a durable identity.

## Decision

Retain the original private owner file, exact single owner and existing
`telegram-owner-only-v1` base profile. Add one separate, optional, mode-0600
numeric ordinary-user file at the fixed `STAGING_TEST_ADMISSION_FILE` reference
`/run/hambazi/staging-test-admission.json`. It contains zero or one Telegram
user ID under `temporary-staging-regular-test-user`, never usernames or roles.
The exception is valid only at the canonical staging origin, paired across API
and Bot and mounted read-only. Preparation rejects partial pairs, shared owner/
tester files, extra identities, username values and owner-as-tester content.

Auth admission reads both private policies on each check. Missing/invalid/linked/
over-permissive tester files deny the tester and preserve valid owner admission;
missing owner authority denies both. Revocation applies to existing sessions,
WebSocket handshakes/commands and personal-game commands. The owner's
`telegramId()` remains separate from ordinary admitted identities. No admin
role, operator credential, internal bearer, catalog activation or public admin
route is granted. Personal game ownership remains the authenticated human seat;
one admitted human cannot read/control another's game.

Initial resolution uses only an original, recent private `/start` received by
the existing HTTPS Telegram webhook after constant-time secret verification and
distributed admission. A temporary Bot observation opt-in matches the requested
username, verifies sender=private chat, rejects bots/forwarded/edited/business/
via-bot updates, and records only numeric identity and minimal update provenance.
It expires after thirty minutes and writes once to a mode-0600 private container
tmpfs file. It grants no admission, registration or session. The operator checks
that evidence, preserves it privately, populates only the numeric tester file,
and removes the observation opt-in. Never fabricate a live Telegram update or
reset/poll/drop the configured webhook backlog to resolve an identity.

Admission and `/start` do not create or complete a profile. Explicit existing
registration intent remains required. Support receipts and outcome
acknowledgements admit the regular tester as the sender, while every delivery
and support acknowledgement still requires the original owner as destination.
The registration, description, text-only start and menu behavior remain intact.

Deploy using clean pinned images, existing maintenance/drain/TLS/rate-limit/least-
privilege controls, normal fresh scans and the existing containment schedule.
No migration, backfill, security-freshness exception or timer extension is needed.
Rollback to code without this exception remains under maintenance. This bounded
second human does not authorize public traffic or production acceptance.

## Alternatives

- Permanently authorize the username: names can change or be reassigned.
- Add the tester to the owner identity tuple: risks changing support/admin identity.
- Register on first `/start` or bypass registration: conflicts with explicit consent.
- Enable public staging or new multiplayer admission: exceeds this narrow request.

## Consequences

Two specifically admitted humans can independently use existing ordinary
features, subject to registration and personal-game membership. Owner credentials,
support recipient and operation remain unchanged. Real native tests are performed
by the account holder; automated signed protocol fixtures are reported separately
and do not stand in for Telegram identity verification or native acceptance.
Revocation requires removing the numeric tester entry, preserving the mounted
file inode, or re-preparing/recreating the paired services under maintenance.

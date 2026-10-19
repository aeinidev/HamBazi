# ADR-071: Explicit Main Mini App invitations and owned outbox delivery for restricted Kahroba

- Status: Accepted for local implementation by the owner's Fast-Track Kahroba Playable Staging instruction; live activation requires separate final approval.
- Owner: HamBazi project owner
- Date: 2026-10-17
- Supersedes: No public Room v1, result, engine or normal security policy.

## Context

The existing development Bot has a verified Main Mini App but no named short name. Current named-only invitations prevent private Kahroba runtime startup. Staging also retains715 pending personal-match notifications belonging to another workflow, which the general outbox dispatcher must not claim or fail. The owner approved a fresh-container-scan deferral solely for the two-account staging test and requested existing production gates remain unchanged.

## Decision

Use an explicit `ROOM_MAIN_APP=true` target with the verified Bot username and invite budget; reject simultaneous ROOM_APP_NAME, invalid/implicit mode values or incomplete policy. Existing named behavior remains unchanged by default. Main links use Telegram's documented `https://t.me/<bot>?startapp=<opaque-start-param>` format. Authentication, admission, canonical invite encoding, host membership and quotas remain server-authoritative. No BotFather change.

Named Room responses remain schemaVersion1 and the public v1 contract remains frozen. Main invitation responses use schemaVersion2 and are accepted only by the private Kahroba HTTP/client adapter. Freeze a new private runtime v2 contract alongside v1. Old public routes never emit a new Main response silently. This does not change any game/result/state schemas.

Each outbox consumer declares owned event types. Parameterized SQL filters those types before LIMIT/row locking and attempts/lease writes; completion/failure/redrive are scoped likewise. The general Worker owns its five existing match/chat queue types; personal/history and unknown future workflows are untouched. Malformed explicitly owned events retain quarantine, fencing, retries and deduplication.

The explicit staging-test preparation path can record `deferred-not-passed` instead of a fabricated passing image scan. It is bound to the exact approved VPS/daemon, clean artifact provenance/digests, existing owner/tester file hashes, protected Bot/data/ingress identities and a finite unchanged containment timer/service. Default/global vulnerability gates, severity, TLS, package signatures, Gitleaks and normal production acceptance remain unchanged. No automatic renewal/rebinding, public access or deployment authority is granted. The final activation approval must seal exact artifacts and deadline; expired/drifting bindings fail closed.

## Alternatives

Creating an unapproved named app, supplying a dummy name, weakening old contracts, acknowledging/deleting personal events or forging scan reports violates the task. Waiting for fresh advisories is intentionally deferred only for this restricted staging test.

## Consequences

Main-only testing requires no Bot changes. Changed application artifacts need new essential tests/build evidence; unaffected verified evidence can be reused. Active/historical Coup and Anarchist pins, data, user registration, authentication and current Bot service remain intact. v1/v2 result compatibility and rollback retain their independent gates. No production qualification is inferred.

## Reference

[Telegram — Main Mini App launch and startapp](https://core.telegram.org/bots/webapps#launching-the-main-mini-app), verified October17,2026. Existing ADR-050 records the Main-only implementation gap and disposable staging recovery limits; any final recovery scope extension must remain explicit.

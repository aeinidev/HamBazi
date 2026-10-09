# ADR-057: Explicit Bot registration and durable support submission

- Status: Accepted for the requested owner-only staging onboarding
- Owner: HamBazi project owner / sole staging operator
- Date: 2026-10-09
- Related: ADR-049, ADR-050, ADR-055; architecture Auth/Users and Telegram adapters
- Supersedes: treating a technical account row as completed registration

## Context

The owner requests the supplied banner in the native pre-Start description, explicit minimal registration,
the native blue reply-keyboard action, profile/support buttons, and an Open
Mini App menu. Support stays in the Bot and is sent only to the same previously
verified staging owner, explicitly confirmed by the owner for this task.
Existing technical accounts and earlier Mini App account creation are not
evidence of explicit registration. Public launch remains HOLD.

## Decision

Users owns a nullable registration completion timestamp. Only explicit verified
private-chat registration intent sets it, idempotently, without replacing an
existing profile or backfilling old users. New profiles reuse the verified
Telegram name through the existing 40-code-point profile policy; names outside
that policy use the neutral Persian display name «بازیکن». No additional
personal information is requested. Technical account creation remains compatible
and does not complete registration.

Auth validates signature/freshness and owner admission before registration.
Session issuance and every session authentication recheck durable completion,
including existing tokens and WebSocket handshakes/commands. A new additive
`/v1/auth/telegram-mini-app/registered-session` endpoint exposes the specific
`REGISTRATION_REQUIRED` result for the Persian return-to-Bot screen. Existing
v1 endpoints preserve their exact wire schemas and map this denial to their
existing unauthorized result. Direct URLs share the same server gate.

Auth's existing receipts and versioned conversation flow own support composition.
`BOT_SUPPORT_TIMEOUT_MS` defaults to 900000 and accepts 60000–900000. Only the
next ordinary text during an admitted registered composition is submitted.
Cancel, start, recognized commands/navigation and expiry never forward text.
Unsupported media and messages over 3500 UTF-16 units retain composition and
request text/a shorter message without truncating the submission.

The accepted text and minimal private profile envelope are stored atomically
with the receipt/flow transition, then delivered outside the DB transaction.
The destination comes only from the verified owner admission file. The API
credential can change delivery status/lease/attempt/message ID, but cannot edit
accepted text; Worker has no support-table privilege. Text is never telemetry.
The disposable staging storage uses the existing maintenance controls; this
decision does not define production support/chat retention.

A CAS delivery attempt prevents concurrent duplicate sends. A definitive
Telegram rejection retains the submission and permits an explicit support-button
retry. A network timeout or abandoned in-flight lease becomes UNKNOWN and never
automatically resends. A late confirmed acknowledgement can reconcile that exact
attempt to DELIVERED. Without such evidence, the operator reviews the private
tracking ID against the administrator chat; no success or safe retry is inferred.
Telegram redelivery resumes the persisted outcome and sends the user confirmation
only after confirmed delivery. The new internal experience routes coexist with
legacy onboarding routes during the release overlap.

The 2026-10-09 owner correction supersedes the initial welcome-media placement.
The packaged JPEG is a BotFather Description Picture asset. Initial and repeated
`/start` replies use only «برای ادامه، از دکمه‌های پایین استفاده کن.» with the
existing one-button/two-button keyboard. They never upload photos. The approved
Persian introduction is set/read back as the default and Persian native bot
Description using an identity-checked explicit operator action. Description
Picture requires the owner's BotFather session; no bot-token API method or
profile-photo replacement is inferred. The exact manual step is documented.
Only default and verified-owner menu overrides are applicable to this owner-only
deployment; both remain web_app/Open at the existing approved HTTPS URL.
The exact POST webhook route preserves private TLS
verification, secret validation, distributed rate limits and durable update
deduplication. All other Bot host routes stay closed. No polling/backlog discard,
credential rotation, unrelated Telegram setting or public admission is authorized.

## Alternatives

- Automatic registration at login/start or mass backfill: loses explicit consent.
- Browser-only registration gate: allows direct API/socket bypass.
- External support link or volatile composition: conflicts with the requested flow.
- Blind retry after a timeout: can duplicate administrator delivery.
- Replacing existing v1 schemas: violates the conservative compatibility gate.

## Consequences

The current owner explicitly taps registration once, preserving existing game
data. The schema expansion and old internal paths remain compatible for rollback,
but an older application does not enforce the new registration semantics and
must remain under maintenance if restored. The owner reported the initial functional iPhone tests passed on source `370bec5`,
including profile, Open, support, cancel and unsupported media. The report is
retained with no inferred client version. Those unchanged flows remain accepted;
the focused text-start/Description Picture placement needs its own confirmation.

Telegram keyboard styling and menu behavior follow the official
[KeyboardButton API](https://core.telegram.org/bots/api#keyboardbutton) and
[setChatMenuButton API](https://core.telegram.org/bots/api#setchatmenubutton).
Older clients may use native fallback styling. The owner now explicitly requests native
[description media](https://core.telegram.org/bots/features#about-text-description-and-profile-media);
setting Description Picture is the remaining manual BotFather action.

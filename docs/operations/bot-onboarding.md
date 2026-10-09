# Bot onboarding staging operation

Current staging now admits one verified ordinary tester alongside the unchanged
owner under [ADR-058](../adr/058-narrow-staging-regular-test-user.md). See the
[current binding](../../infra/docker/staging/staging-test-user-current.json) and
[tester operation/retest instructions](staging-test-user.md). Registration remains
required, support goes to the original owner, and public admission remains disabled.
The text-only start and native Description Picture instructions below still apply.

Historical scope: owner-only `@Hambazidev_bot` onboarding under ADR-057; public
release HOLD. The [historical onboarding binding](../../infra/docker/staging/bot-onboarding-current.json)
records deployed clean source `83caa80`, four healthy application pins, routes and
private evidence. The default/Persian native Description and Open menu are read
back successfully; the webhook queue is empty. A historical 503 from before this
replacement is retained, with no new error observed. Description Picture remains
the explicit owner BotFather step below.
`execution-current.json` preserves the older personal-staging closure; its native
and exact-pair rollback observations apply only to their recorded sources.

## Focused owner correction — 2026-10-09

The owner reported that the requested iPhone functional tests passed on source
`370bec5`: registration/registered keyboard, profile, Open, support delivery,
cancel and unsupported media. Client version was not supplied; no direct agent
observation is inferred. Preserve this acceptance for those unchanged flows.

The owner then corrected banner placement. Initial and repeated `/start` now
send only:

> برای ادامه، از دکمه‌های پایین استفاده کن.

The existing keyboard stays identical: one blue «ایجاد حساب کاربری» button for
an admitted unregistered account, or «پروفایل من» and «ارتباط با پشتیبان» after
explicit durable registration. No photo or banner is uploaded by `/start`.

The approved Persian introduction belongs in Telegram's native Description,
visible in an empty bot chat before Start. The operator-only `configure:description`
script verifies bot identity, sets the default/Persian descriptions, and reads
both back. It does not set profile imagery or unrelated settings.

The supplied image is retained as
[description-picture.jpg](../../apps/bot/assets/description-picture.jpg).
The bot-token API does not expose a Description Picture setter. The remaining
owner action uses the existing BotFather session:

1. Open the verified `@BotFather` chat and send `/mybots`.
2. Select `@Hambazidev_bot` → **Edit Bot** → **Edit Description Picture**.
3. Send the linked image as a **Photo** when BotFather requests it and wait for
   confirmation. Inspect the native description before Start in a first-time/empty
   bot chat. Keep the existing account and support history.

This is the official
[Description Picture setting](https://core.telegram.org/bots/features#about-text-description-and-profile-media).
The native image is not claimed configured until that action is confirmed.

## Operator procedure

After normal checks and exact artifact scans, prepare the existing private
services. Fifteen migrations and twelve unchanged contract baselines remain;
the text-start correction needs no migration, registration reset or backfill.
Preserve the existing profiles, game data and accepted support submissions.
The webhook proxy forwards only POST `/v1/telegram/webhook`, Content-Type and
Telegram secret header to the fixed private TLS Bot listener, verifying the
existing CA and certificate identity `10.89.18.11`. Other Bot routes stay closed.
The additive registration session route preserves owner-only game admission.

Run the declared Bot `configure:menu` and `configure:description` scripts inside
the prepared Bot container. Default and owner menu overrides must read back as
Open at `https://staging.hambazi.top/`; Telegram canonicalizes the root URL with
its trailing slash. Credentials and owner IDs remain in existing private files.
Keep the existing webhook: never run getUpdates concurrently or discard backlog.
Record safe menu/description/webhook metadata only.

Real START receipts reached DONE during the initial deployment and one explicit
REGISTER completed the owner's existing profile. The owner subsequently confirmed
real support delivery. Never substitute forged user updates or a SQL registration
backfill for these actions.

Support UNKNOWN is unresolved delivery. Inspect the private tracking ID in the
administrator chat and durable record; only a confirmed message ID for the same
attempt justifies reconciliation. Retain accepted text and never blindly resend.
Do not put support text, names, secrets or raw Telegram updates into telemetry.

Root `pnpm check`, real PostgreSQL/Redis integration, six production E2E cases,
28 browser cases and packaged smoke passed. Unchanged game/auth/support evidence
is retained, while the changed Bot transport is tested with initial/repeated
text-only sends and native description verification. The current binding records
exact source scopes; automated checks never establish a native image setting.

The existing normal 24-hour advisory containment timer remains enabled. Current
scan evidence expires at **2026-10-09 22:35:21 Asia/Tehran**. Refresh under the
existing operating policy before that deadline to keep owner traffic available.
No freshness exception, public launch or new exact-pair rollback is inferred.

## Focused iPhone retest

The owner's registration is already complete; do not delete/reset it.

1. Send `/start` twice: each new reply has exactly the short Persian text above,
   no new photo, and exactly the profile/support keyboard.
2. Verify profile and Open still work. The owner already accepted these flows;
   this is a quick regression check of the focused presentation correction.
3. After the manual BotFather upload, inspect the banner and introduction in the
   native description before a first-time user presses Start. This does not admit
   that user to owner-only staging.

The unregistered keyboard and server-enforced Persian registration screen retain
unit, integration and earlier live browser/API evidence. No account reset or
additional owner enrollment is authorized merely to repeat that test.

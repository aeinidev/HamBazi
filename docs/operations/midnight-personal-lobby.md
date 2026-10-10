# Midnight lobby and personal request correction

The restricted staging now serves clean app source `55a4b19`, with the Midnight
lobby/Coup entry introduced in `4d7db58`. The supplied display font, live Persian
controls and separate Coup/Hokm/Ludo artwork are deployed; Hokm and Ludo remain
disabled. [Architecture](../architecture/midnight-personal-lobby.md),
[asset provenance](../design/midnight-assets.md) and the
[exact deployment binding](../../infra/docker/staging/staging-test-user-current.json)
record the implementation and evidence.

The four exact images were opened to restricted traffic at
2026-10-10 11:28:49 Asia/Tehran. Eight actual application/component/data image
scans pass the normal 24-hour policy, without suppression or freshness exception.
The unchanged containment timer expires at **2026-10-10 22:36:47 Asia/Tehran**.
Preparation is `prepared-personal-requests-20261010`; the preceding compatible
`prepared-midnight-lobby-20261010` and its images remain available. No new migration
or registration backfill ran; the same 15 migrations and contract baselines apply.
This is personal staging, with public/production release still HOLD.

## Verified request overlap

The account holder initially reported that the Midnight screens/navigation worked,
but gameplay sometimes displayed “many requests” and retry. The personal gateway
rejects a second pending request on a socket with `RATE_LIMITED`, independently of
its Redis quota. The frontend's two-second catchup could overlap a foreground
game command or reconnect lookup. A held-read regression reproduces that error
before the correction: two requests on the wire, one rejected. The corrected
personal transport shares a bounded lane: one on the wire, up to four locally
accepted requests. The same regression then has one on the wire and zero overlap
rejections, including the actual production UI in Chromium and WebKit.

Payloads, action IDs and expected versions are preserved. A queued request from
an old connection fails without being sent on the new connection. Genuine quota
rejections are surfaced and are never automatically retried. Two-second polling,
the deployed 120 events/minute quota, server pending guard, admission, engine and
ordinary realtime transport are unchanged. This fixes the verified concurrency
defect; the adapter has no per-event denial telemetry, so the original native
error cannot be retrospectively correlated to a specific denial record. The
before/after figures above are controlled reproduction counts, not native timing
or production load measurements.

## Verification and native result

Root checks pass, including formatting, lint, boundaries, typecheck, unit tests,
build and contract compatibility. There are 78 Web unit tests, 30 Midnight browser
cases in Chromium/WebKit and 28 existing browser cases. The four actual packaged
images pass 44 runtime checks and two packaged browser cases. Secret scans and
dependency audit have zero findings. Previous real PostgreSQL/Redis personal HTTP
and font-MIME evidence is reused with byte equality for 529 backend/config/infra
files; it is not presented as newly rerun integration evidence.

All four deployed roles are healthy. Delivered HTML/JS/CSS/SDK, font and artwork
match the actual packaged bytes. The deployed browser checks use synthetic auth
responses and never mutate real accounts. Chromium uses direct HTTPS; Linux
WebKit renders TLS-verified HTTP responses through a request adapter because its
direct HTTPS navigation was unavailable. This is not a native Telegram test.

Compiled API/Bot admission allows the original owner and the one verified numeric
ordinary tester and denies an unrelated identity. Admin, internal health and the
ordinary catalog return 404. The original owner file, read-only numeric admission,
explicit registration requirement and support destination are unchanged. Default
and owner menu labels were restored to the previously approved Open label at the
same URL. The tester inherits the default. No webhook/backlog, account, role or
description text was changed; existing default/Persian descriptions are nonempty
and preserved, but their texts differ. Description Picture remains the separate
existing owner BotFather step.

After deployment the user answered **«اوکیه»** to the focused native retest. Record
this as user-reported functional success with no new error reported, not direct
agent observation. The reply did not separately identify the account, client
version, iPhone model or each individual step. Read-only durable metadata after
opening this release shows seven owner commands and two terminated owner matches;
the ordinary tester has no new game commands in that interval. A newly completed
natural game or every requested reconnect step is not independently established.
Prior complete-game evidence retains its original binding; no new full-game or
tester-specific proof is invented.

## Capacity and recovery evidence

The initial `4d7db58` rollout encountered a verified image-layer extraction failure
from insufficient disk space. Recovery removed only rebuildable dependency caches
from four historical operator runners and eight exact unreferenced historical app
images (`65ff180` and `175f4e0`), with recoverable copies verified locally. Current
and previous compatible images, data volumes, scan database, secrets and
containment were retained. The original failure and recovery records remain in
the preceding private evidence index.

For `55a4b19`, all four candidate layers were materialized with temporary containers
before maintenance. The containers were never started, had no mounts and were
removed; 1.50 GB remained free. The previous services stayed healthy during this
check, then drained gracefully. No additional cache cleanup was needed.

## Repeat the focused Telegram test

1. With an admitted registered account, close the Mini App and reopen it through
   Open in `@Hambazidev_bot`.
2. Choose Coup → شروع بازی. Play at normal speed during your turns; a pending
   catchup must not generate “Too many requests”. Finish a game against the bot.
3. During another active game, go back to Coup and reenter, then close/reopen the
   Mini App. Both should resume the same match.
4. If an error returns, report Tehran time, the pressed button, Telegram version
   and iPhone model. Do not create a replacement profile or change admission.

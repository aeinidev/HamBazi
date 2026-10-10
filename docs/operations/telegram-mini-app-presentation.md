# Telegram Mini App launch presentation

Restricted staging deploys clean source `8a3d319`. The shared Telegram bootstrap
requests `requestFullscreen()` once per bridge/document on Bot API 8.0+ when
the app is not already fullscreen, and `disableVerticalSwipes()` on 7.7+.
Missing APIs, version checks and native exceptions degrade to the existing
expanded app. Fullscreen exit/failure, activation, resizing and navigation do
not retry the request. A newly opened document has a new launch attempt.

The existing safe-area/content-safe-area padding on all shells is preserved;
fullscreen changes also refresh the current insets. No touch/scroll event is
cancelled, body scrolling is not locked and native close/minimize controls are
not hidden. Telegram can still minimize via its native header; button-only
minimization is not guaranteed. See the
[official Telegram API](https://core.telegram.org/bots/webapps#initializing-mini-apps).
Authentication, URL credential cleanup, registration, navigation, personal
request serialization, gameplay and Bot flows are unchanged.

Focused checks pass: lint, formatting, boundaries, Web typecheck, 85 unit cases,
38 Midnight browser cases (eight new presentation cases), 28 existing browser
cases, 44 actual packaged runtime checks and two packaged browser cases.
Chromium/WebKit use the unmodified pinned SDK to test native request dispatch,
versions 7.6/7.7/8.0, exit/failure without retry, scrolling, touch, insets,
settings editing and existing-game navigation. Delivered staging HTML, JS,
CSS, SDK, font and art match packaged bytes; synthetic registered-session
responses are used, with no real account mutation. Chromium uses direct HTTPS;
Linux WebKit uses a TLS-verified request adapter. These checks do not establish
native Telegram acceptance, which remains pending the user's iPhone test.

Eight exact app/component/data images pass normal fresh scans. The existing
containment timer remains enabled with its unchanged deadline, 2026-10-10
22:36:47 Asia/Tehran. Four exact roles are healthy. Numeric owner/tester
admission, registration requirement, original-owner support destination and
closed admin/public access are preserved. No migration/backfill or Telegram
setting changes ran. The previous `395c6e7` images and preparation remain
available. Four exact unreferenced historical `4d7db58` image caches were
removed only after local recovery copies were verified; data, scan cache,
secrets and containment were preserved. Candidate layers were checked before
maintenance. All 125 pre-existing Markdown instruction/document files,
including supplied source instructions, retain their exact bytes. Backend
integration evidence is retained with equality for 444 backend/policy/lock
files; the full backend/root suite was not rerun for this adapter change.

The [current deployment binding](../../infra/docker/staging/staging-test-user-current.json)
records image pins, preparation and private evidence hashes. Public/production
release remains HOLD.

For the native retest, fully close and reopen Open in `@Hambazidev_bot` with a
registered admitted account. Check fullscreen launch, scrolling and downward
gestures inside the lobby/tutorial, settings keyboard/editing and game controls.
Confirm native close/minimize controls remain reachable and content avoids
the notch/native controls. If Telegram provides fullscreen exit, exit and
navigate between screens without an automatic fullscreen re-entry. Send the
result, iPhone model and Telegram version; acceptance stays pending until success.

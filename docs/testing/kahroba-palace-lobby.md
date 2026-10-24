# Kahroba palace lobby integration

Current implementation of the owner-approved [palace prototype](https://kahroba-palace-lobby.rareeagle6.chatgpt.site/), with [ADR 075](../adr/075-kahroba-palace-lobby-public-matchmaking.md) and the additive [lobby v2 contract](../contracts/kahroba.lobby.v2.json).

## Product behavior

The mobile RTL home uses the approved gemstone/card wordmark, palace background, larger authenticated profile/name, a single notifications control, dark create/search buttons and the revised settings/guide icons. No online count, rotating statistics, scan button or fictional profile is introduced. Sound/motion preferences persist locally; authentication, invitations and game state do not.

Private creation accepts capacities 2, 3 and 4. Sharing still verifies host identity, current room state, the exact issued invite and authenticated resolution before opening the native chooser or browser fallback. Real members fill the roster; no timer invents joining or readiness. The full roster is prepared into a waiting Match, all players mark readiness, and the host explicitly starts. Before roster preparation, room leave preserves the existing host-transfer policy. The host may cancel a prepared waiting lobby, which terminates the match and closes the bound room.

Public creation/search enters the standard matchmaking partition for the selected capacity. It uses the shared durable ticket/reservation/commit and Redis queue. Search can be cancelled atomically; a committed match wins the cancel race and proceeds to admission. The UI automatically enters the member lobby after finding/admitting a real group. Current-ticket recovery survives a fresh signed Mini App launch and API restart. Fully ready public matches remain waiting until the persisted host starts them. Replaced active seats retain spectator access through the existing view policy.

## Verification

- API unit/contract/service tests: 1,013 passed.
- Web unit tests: 123 passed.
- Configuration tests: 274 passed, including the approved two-to-four-seat capacity.
- Chromium/WebKit UI suites: 90 passed. These include fixture-based visual/accessibility/interaction checks at 320/375/390/768px, invitation failures, double taps, session expiry, settings persistence and gameplay regression.
- Production build for Web/API/Worker/Bot: passed. Vite retains a non-blocking application chunk-size warning.
- API contract checks, TypeScript, lint and module-boundary checks: passed in local verification.
- Matchmaking integration: 12 passed on disposable PostgreSQL/Redis, including twelve cancel-versus-match races, reservation expiry, lost commit responses, and re-enqueue from a durable status read after Redis restart. Match-owned row locks and bounded retry backoff prevent reservation/cancellation contention from exhausting immediate retries.
- Database boundary unit tests: 35 passed, including owner/transaction-only row locks, safe classification of aborted transactions and redaction of private error metadata.
- Actual-main disposable PostgreSQL/Redis runtime acceptance: all 10 distinct scenarios passed across combined and focused runs, including all four actual Web/API/Worker browser scenarios. The latest combined run had 9 passes and one 120-second timeout in the private four-player autoplay case. Its focused rerun passed in 51.92 seconds, finishing after 116 turns; the original timeout bound was retained. This is recorded as runtime-suite timing variability rather than claiming an entirely green final combined invocation.
- Disposable foundation integration: 17 passed; Worker Kahroba integration: 3 passed.
- Infrastructure source tests: 170 passed, 2 skipped, using the generated-output exclusion below. An earlier unfiltered local run also picked up an ignored historical candidate copy and timed out inside that copy. Historical candidate artifacts were preserved.

The fixture-based UI suite is separate from actual-main runtime acceptance. The latter uses real Telegram HMAC verification with synthetic local identities, the normal Web/API/Worker entry points, real PostgreSQL transactions and real Redis coordination. Its public cases cover capacities 2/3/4, cancellation, durable recovery, API restart, member/host authorization, readiness, idempotent host start and complete games. Its browser cases exercise private invitation/gameplay and three-player public UI flow in both Chromium and WebKit.

Commands use existing repository scripts:

```sh
pnpm --filter @hambazi/api test
pnpm --filter @hambazi/web test
pnpm --filter @hambazi/config test
pnpm --filter @hambazi/api typecheck
pnpm --filter @hambazi/web typecheck
pnpm --filter @hambazi/web test:kahroba
pnpm test:kahroba:local --runtime
pnpm test:kahroba:local --runtime --runtime-browser-only
pnpm test:kahroba:local --matchmaking-only
pnpm test:kahroba:local --runtime --runtime-test-name 'real main API/Worker: 4'
pnpm lint
pnpm check:architecture
pnpm test:infra --exclude 'test-results/**'
pnpm build --filter=@hambazi/api --filter=@hambazi/web --filter=@hambazi/worker --filter=@hambazi/bot
pnpm --filter @hambazi/api contract:check
```

Selected screenshots and verification metadata are copied to ignored local `test-results/kahroba-palace-lobby-20261023/`. The UI and runtime harnesses also retain outputs under `test-results/kahroba-lobby-mvp/` and `test-results/kahroba-k4a/`. The imported images match the approved originals byte-for-byte; [asset provenance](../design/kahroba-palace-lobby-assets.json) records their hashes. Existing historical reports and frozen contract snapshots remain historical evidence.

## Deployment boundary

This section records the earlier local implementation phase. The subsequent owner-authorized [server release and main-card activation](../operations/kahroba-palace-deployment-20261023.md) has separate deployed verification.

This task changes repository code only. It does not deploy, edit admission files, activate the ordinary public catalog, change engine/version pins or alter database schemas. The existing runtime flags and authenticated cohort policy still govern access. Four-person staging play needs four legitimately admitted identities through the release process. Native Telegram device acceptance, staging smoke/load/soak and launch-readiness decisions are not claimed by local tests.

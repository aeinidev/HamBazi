# Temporary staging native Mini App startup

Scope: owner-only personal staging; ADR-055. On 2026-10-09 Tehran the owner
confirmed the real iPhone Telegram Mini App retest succeeded and everything
worked as expected. Record this as **user-reported native acceptance** of
`a8b97f8` / `prepared-20261008-native-02`, not agent observation or inferred client
versions/full-game measurements. The original failure and unknown exact cause
remain historical; do not reopen acceptance merely for retiring its display.

Current clean source `48ff852`, preparation
`/opt/hambazi-staging/private/prepared-20261009-native-accepted-02`, removes the
temporary native-01 UI and enforces an existing Redis admission reply deadline.
SDK/bootstrap/Auth signature/freshness/owner policy are unchanged. Six current
actual-network Chromium/WebKit fragment/query/non-owner scenarios pass separately,
without claiming a new owner iPhone retest. See the
[current binding](../../../infra/docker/staging/execution-current.json).

## Owner launch and future regression investigation

1. Use the existing Telegram Main Mini App link
   `https://t.me/Hambazidev_bot?startapp`, or **Launch app** on the bot profile.
   Opening the plain staging URL in Safari does not supply Telegram credentials.
2. Tap **Continue with Telegram**; an existing admitted account reaches
   **Temporary owner staging** and **Personal Coup test**. If needed, the existing
   account-creation form remains guarded before any durable account write.
3. **Start game with bot** is the enabled personal test flow. Invitations/Admin/
   ordinary catalog/gameplay remain disabled. No Telegram setting is changed.
4. After sign-out, obtain a fresh native launch; credentials are memory-only. For
   a future stale minimized document, fully close the Mini App/Telegram and relaunch.
   native-01 is intentionally absent in the accepted successor.

If a new regression occurs, inspect the actual bound artifact, redirects/URL
cleanup, SDK loading/guarded initialization and actual Auth response. Query-only
launch can have empty SDK.initData while the reviewed loader preserves launch in
memory; SDK download/presence alone is not initialization/authentication evidence.
Do not ask the owner for initData, credential-bearing links, profile contents or
game screenshots. Use only fixed presence/state/auth-code diagnostics if needed.

## Technical boundary

- SDK bytes are immutable, reviewed and served from the Web artifact. Build-time
  SHA-384 verification and script SRI remain mandatory. No runtime external SDK
  request, broad CSP allowlist, inline/eval permission or frame expansion is needed.
- Storage guard runs before SDK loading. Fragment and guarded query-only initData
  stay in memory; URL cleanup remains enabled. A loader/guard failure grants none.
- Signature, freshness, constant-time comparison and exact server owner admission
  are unchanged. Diagnostic presence flags never authorize a request.
- Temporary native-01 display is removed after owner acceptance. Closed diagnostic
  state stays memory-only. Any future investigation may temporarily display only
  SDK/launch presence, initialization state and fixed auth status/code; never raw
  errors or a telemetry sink.
- Verify real deployed HTML/CSP/assets and actual auth outcomes, not SDK download
  success alone. Preserve failed attempts and native/browser distinctions.

[Telegram Main Mini App flow](https://core.telegram.org/bots/webapps#launching-the-main-mini-app)
and [ADR-055](../../adr/055-reviewed-same-origin-telegram-startup.md).

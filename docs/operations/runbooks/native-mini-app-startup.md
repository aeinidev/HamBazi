# Temporary staging native Mini App startup

Scope: owner-only personal staging; ADR-055. Native acceptance remains failed at
the owner's reported missing-launch screen until the owner verifies the fix on
their actual iPhone. Synthetic browser results are separate evidence.

The replacement is deployed from `a8b97f8`, using
`/opt/hambazi-staging/private/prepared-20261008-native-02`. Six actual-network
Chromium/WebKit query/fragment/owner/non-owner startup scenarios pass; this does
not substitute for the iPhone result. See the [current binding](../../../infra/docker/staging/execution-current.json).

## Mobile retest

1. Close the Mini App with its close control, rather than minimizing it. Close and
   reopen Telegram once to discard the previous in-memory document.
2. In Telegram, open `https://t.me/Hambazidev_bot?startapp`, or use the configured
   Main Mini App **Launch app** button on the bot's profile. Do not open the plain
   staging HTTPS URL in Safari or Telegram's ordinary link browser. This uses the
   existing Main configuration and changes no Telegram setting.
3. Find **Telegram startup check · native-01**. Expected before sign-in:
   `SDK: present`, `Launch data: present`, `Initialization: ready`,
   `Authentication: not-requested`.
4. Tap **Continue with Telegram**. Expected: `Authentication: authenticated` and
   the **Temporary owner staging** screen with **Personal Coup test**. If an owner account has not yet been
   created, use the existing account-creation form; backend owner admission still
   applies before any durable account write.
5. Only after sign-in succeeds, optionally use **Start game with bot**. Report
   native acceptance only after the owner confirms this actual client result.

If blocked, report only the four diagnostic lines (including a fixed error code,
if present) and optionally iOS/Telegram versions. Never send raw initData, a launch
URL containing Telegram fields, credentials, profile contents or game screenshots.
The native-01 marker is required to distinguish the new artifact from an old
minimized document. A clean reload deliberately has no stored launch credential;
obtain a fresh native launch instead.

## Technical boundary

- SDK bytes are immutable, reviewed and served from the Web artifact. Build-time
  SHA-384 verification and script SRI remain mandatory. No runtime external SDK
  request, broad CSP allowlist, inline/eval permission or frame expansion is needed.
- Storage guard runs before SDK loading. Fragment and guarded query-only initData
  stay in memory; URL cleanup remains enabled. A loader/guard failure grants none.
- Signature, freshness, constant-time comparison and exact server owner admission
  are unchanged. Diagnostic presence flags never authorize a request.
- Diagnostic fields remain client memory/UI only; no raw error or telemetry sink.
  Remove temporary display after the native blocker is resolved.
- Verify real deployed HTML/CSP/assets and actual auth outcomes, not SDK download
  success alone. Preserve failed attempts and native/browser distinctions.

[Telegram Main Mini App flow](https://core.telegram.org/bots/webapps#launching-the-main-mini-app)
and [ADR-055](../../adr/055-reviewed-same-origin-telegram-startup.md).

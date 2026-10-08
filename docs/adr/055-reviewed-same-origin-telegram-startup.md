# ADR-055: Reviewed same-origin Telegram startup and safe native diagnostics

- Status: Accepted implementation decision under the owner's explicit native-blocker remediation scope
- Owner: HamBazi project owner/operator
- Date: 2026-10-08
- Related: ADR-014, ADR-037, ADR-038, ADR-052, ADR-053, ADR-054

## Context

The owner reports the deployed d28d4b0 native iPhone Mini App still renders the
missing-launch message. Actual deployed response/artifact checks show trusted
HTTPS, no HTTPS redirect, no-store, exact CSP and the reviewed SDK pin. Chromium
and WebKit replay of these actual responses initialize with fragment launch data;
a query-only launch loses its data. External SDK network failure is reproduced
separately. These do not establish the exact iPhone cause: no actual native
startup observations have been received. The UI currently merges every loader
failure with a missing Telegram launch and hides which boundary failed.

## Decision

Deliver the unmodified official SDK reviewed on Oct 8 from the immutable Web
artifact, under `/telegram-sdk/telegram-web-app-3f223aba4f0ede97.js`. Preserve its
exact SHA-384 SRI pin, anonymous script CORS and no-referrer. Every production
build verifies the included file against the source pin before copying it;
modified/empty/oversized bytes fail the build. The public emitted asset is mode
0644, and packaging verifies UID-1000 readability and SRI inside the actual
read-only, network-isolated image before publishing its inventory. Exclude only this exact third-party
file from formatting/lint rewriting; security and artifact scans still include it.
The official source URL and CI download pin remain recorded. No external script
hostname, inline/eval permission or broader framing/network policy is added.
This changes SDK distribution, not its behavior or authorization authority.

After a successfully guarded SDK load, retain query-only `tgWebAppData` in memory
when the SDK's fragment-derived initData is empty. The original query/fragment is
cleaned from history as before. Query data is an untrusted credential: the same
server signature/freshness/constant-time validation and exact owner admission
remain mandatory. No fallback is granted after loader/privacy-guard failure;
no initDataUnsafe, personal-ID fallback or cached identity is trusted.

Temporarily display fixed staging-only presence/initialization/authentication
states, with a closed allowlist of error codes. No raw URL/launch/body/browser
error, identity, credential or gameplay field is displayed, persisted or sent to
telemetry. Runtime authentication continues to use memory-only credentials.
Record real native acceptance only after the owner's mobile test succeeds;
remove the temporary diagnostic UI once its purpose is fulfilled.

## Alternatives

- Continue runtime external delivery alone: leaves native testing dependent on
  a separately reachable mutable SDK URL and loses useful failure distinctions.
- Broaden CSP or remove SRI: unnecessary and not authorized.
- Trust a query/user ID without backend verification: violates admission rules.
- Declare native acceptance from synthetic browser tests: insufficient evidence.

## Consequences

Official SDK updates need a new review, checked file/pin and immutable release.
The current source bytes remain pinned until then. Browser compatibility and
network-isolation regressions must exercise the actual included SDK, preserving
storage protection and signed auth requests. Real iPhone results remain pending;
reproduced query/transport issues are not asserted as the owner's exact cause.
The bounded Trivy expiry, role separation, TLS and owner-only scope are unchanged.

## Native acceptance follow-up — 2026-10-09

The owner confirms that the real iPhone native Telegram retest succeeded and
everything worked as expected. Record this as user-reported native acceptance
of clean `a8b97f8` / `prepared-20261008-native-02`, separately from agent-observed
browser evidence. It closes the reported native blocker; the exact original
iPhone failure cause is not inferred. Remove the temporary diagnostic display
now that its purpose is fulfilled. Guarded SDK loading, query/fragment launch,
in-memory credentials, signature/freshness and owner admission remain unchanged.
UI-only successor validation and release-pair rollback evidence must keep their
own source/configuration bindings; the confirmation is not blanket 18B3 completion.

## References

[Official SDK](https://telegram.org/js/telegram-web-app.js),
[Telegram Mini Apps](https://core.telegram.org/bots/webapps),
[CSP Level 3](https://www.w3.org/TR/CSP3/).

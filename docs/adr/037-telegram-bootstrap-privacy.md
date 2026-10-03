# ADR-037: Guarded, integrity-pinned Telegram Mini App bootstrap

- Status: Accepted for the owner-approved Phase 17A3P prerequisite correction
- Owner: HamBazi engineering
- Date: 2026-10-03
- Related: ADR-014, ADR-027; architecture sections 14.6/16.2

## Context

The Phase 17A3 prerequisite review found that the official Telegram SDK runs
before HamBazi and persists its launch parameters, including raw `tgWebAppData`,
in `sessionStorage.__telegram__initParams`. A clean URL reload restores that
credential. Existing browser tests replace the SDK with a synthetic bridge and
therefore miss this violation of the approved memory-only credential boundary.
The owner explicitly approved correcting this prerequisite first. Broader CSP,
admin design, deployment and live activation remain separate gates.

## Decision

Remove the parser-loaded SDK script from HTML. Web platform bootstrap first
deletes the reserved launch-cache key from accessible session and local storage,
using the original native methods, and verifies its physical removal. It then
installs document-lifetime, non-replaceable `Storage.prototype.getItem/setItem`
guards: reads of that exact key return null and writes never reach the native
writer. All other keys, including the SDK's non-sensitive theme settings, retain
ordinary storage behavior. No launch-cache replacement or credential persistence
is introduced.

Load the official HTTPS script only after protection succeeds, with anonymous
CORS, no referrer and SHA-384 Subresource Integrity. The single source pin in
`apps/web/src/platform/telegram-sdk.ts` identifies the official bytes reviewed
on this date (SHA-256
`3549138a7934039fe7dfd1291a4ee739bd2b705a614308053a8b08a87d85c451`). Verified HTTPS
delivery currently permits anonymous CORS. An upstream change fails integrity
instead of executing an unreviewed cache implementation. After reviewing new
SDK storage behavior, update that pin only together with passing real-SDK unit,
development-browser and built-production-browser privacy gates.

Protection/legacy cleanup failure prevents SDK loading and supplies no credential.
Denied browser storage getters are supported: the reviewed SDK catches these
denials, and inaccessible caches cannot be read. If access becomes possible in a
subsequent document, that document must perform physical cleanup first. SDK
network/error/integrity failure or a ten-second loading deadline also supplies no
credential. Bootstrap accepts the explicit loader result; it cannot fall back to
a rejected or late global bridge. Native/test/local-preview bridges already
present still require the same storage protection. The preview remains explicitly
synthetic, development-only and loopback-bound.

Once loading settles, preserve existing URL/history launch cleanup, invitation
routing, theme/viewport/inset events and SDK ready/expand behavior. A clean reload
requires a fresh Telegram launch. Access tokens remain in the runtime closure;
logout/disposal clear HamBazi credentials and private state even when revocation
fails. The SDK's own getter may retain initData in document memory until the
document closes; this does not permit restoration from storage. Backend HMAC,
freshness, session and membership checks remain authoritative.

## Alternatives

- Delete the cache after SDK execution: credentials have already reached storage,
  and the SDK may already have restored a previous identity.
- Block all browser storage: needlessly changes unrelated preferences/theme
  behavior and still does not prove that the guard precedes SDK execution.
- Depend on a mutable SDK URL without integrity: future cache keys or methods
  could bypass the narrowly reviewed guard.
- Fork/vendor the SDK or replace its bridge: adds maintenance and compatibility
  ownership that this focused prerequisite does not need.

## Consequences

The prototype guard is global within this document but changes only the reserved
SDK key; it is not a sandbox against arbitrary same-origin JavaScript or XSS.
It does not erase inaccessible browser data, other origins or unrelated files.
The pin deliberately trades silent upstream updates for sign-in availability:
changed official bytes require a reviewed application release. URL cleanup occurs
after the bounded loader settles; the SDK request itself omits the referrer.
No refresh/session strategy, storage retention, hosting origin, CSP/frame policy
or admin identity provider is selected.

Tests use unmodified official SDK bytes with the same digest, synthetic launch
data and a disposable loopback API fixture. Native writer interception and
original-method reads prove prevention and physical deletion; a bare-SDK negative
control proves these observations detect the original defect. Tests cover legacy
launches, reload, both logout outcomes, unavailable/unmodifiable storage, changed
SDK bytes and delivery failure in development and built production output.
Controlled HTTPS Telegram/mobile WebView and actual provider caching compatibility
remain unavailable deployment evidence, not claimed by local Chromium checks.

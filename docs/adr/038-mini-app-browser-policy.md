# ADR-038: Generated Mini App browser security policy

- Status: Accepted for the owner-authorized Phase 17A3 local implementation
- Owner: HamBazi engineering; deployment origins remain a product/operations decision
- Date: 2026-10-03
- Related: ADR-014, ADR-027, ADR-036, ADR-037; architecture section 16

## Context

The Mini App build needs an enforceable static-host policy independent of the
still-undecided hosting provider. API JSON headers do not protect its HTML. The
guarded official SDK must load under CSP, Telegram Web must be able to frame the
app from explicitly reviewed origins, and Socket.IO needs both HTTP polling and
WebSocket destinations. Credentials and private game/chat data must not become
browser reports, referrers or edge logs.

## Decision

Generate `dist/client/security-headers.json` on every ordinary Web build using
strict, canonical public origin inputs. Production origins require HTTPS; derive
the corresponding explicit WSS destinations. Missing origins allow only self
and missing frame ancestors deny all framing, without selecting production
domains. The explicit `loopback-test` profile permits only loopback Web/API
origins and cannot be served by the declared preview command on a public bind.
The Web build's Turbo cache includes each public policy environment input and
Web-local `.env*` files, preventing reuse of output for a different origin policy.

CSP denies unspecified resources, objects, child frames, workers, form actions,
base elements and script event attributes. Scripts permit self and the exact
reviewed SHA-384 SDK hash from ADR-037. An external SDK script therefore also
needs the matching integrity metadata; its hostname is not a general script
allowlist. Inline scripts and eval remain forbidden. Configure browser-only Zod
interpreted validation before schema imports, avoiding its eval capability
probe without changing server validation or wire schemas.

Styles permit self and inline CSS because the reviewed SDK inserts theme styles
and accepts Telegram Web's dynamic iframe style messages. This is a deliberate
CSS allowance, not script permission. Images/fonts remain self; no data/blob,
remote avatars, analytics or CSP reporting endpoints are added. Use exact
frame-ancestor origins, no wildcard or reflected request origin. Do not add
conflicting X-Frame-Options to Mini App HTML. Preserve API JSON's existing frame
denial. Referrers are disabled, MIME sniffing and unused camera/microphone/
geolocation/payment/USB capabilities are denied, responses use no-store, and
production policy includes host-only HSTS without selecting subdomain/preload
policy.

The ordinary preview verifies the entire artifact against the generator and
current SDK pin, then enforces its headers on static responses, SPA fallback and
errors. The production bundle boundary check also rejects missing/stale/tampered
headers and malformed policy inputs. This is a consistency check, not a signature
or approval of the configured origins; release provenance and comparison to the
approved deployment inventory remain 18A/18B gates. Development/HMR and the synthetic preview keep their existing isolated
configuration. The future approved edge must apply the generated header values;
shipping JSON alone does not enforce a browser policy.

## Alternatives

- CSP in HTML only: frame-ancestors requires a response header and would leave
  edge response consistency unverified.
- Broad Telegram script-host or wildcard frame/connect permission: grants more
  authority than the reviewed SDK, API and framing destinations require.
- Inline-script/eval permission to satisfy dependencies: unnecessary with
  interpreted validation and external application scripts.
- A fixed provider configuration or guessed production domains: resolves OD-002
  outside this phase and cannot reflect an approved deployment inventory.

## Consequences

Any new resource origin, SDK pin or permitted capability requires review,
regeneration and browser tests. Inline CSS remains a bounded compatibility
trade-off; CSP is not a sandbox against compromised self-hosted scripts. No-store
is the conservative candidate baseline; later CDN cache changes need reviewed
release behavior. Real HTTPS ingress, edge header application, Telegram-issued
launches, mobile WebViews and complete public framing-origin inventory remain
deployment gates. No session/refresh strategy, provider, retention policy or
live capability is selected. See [the policy runbook](../security/browser-policy.md).

## References

[CSP Level 3](https://www.w3.org/TR/CSP3/),
[Telegram Mini Apps](https://core.telegram.org/bots/webapps),
[Zod CSP configuration](https://zod.dev/compile#content-security-policy), and
[Permissions Policy](https://www.w3.org/TR/permissions-policy/).

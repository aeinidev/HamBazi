# ADR-074: Cloudflare gateway for the existing Telegram Bot

- Status: Accepted and active in restricted staging; owner-authored `/start` reply and durable receipt verified on 2026-10-21
- Owner: HamBazi project owner / staging operator
- Date: 2026-10-21

## Context

The Mini App and application backend run on 89.46.217.9. The Bot can authenticate
to the private API, but its direct outbound Telegram requests time out. The owner
connected Telegram to `telegram-bot-server.aeinidev77.workers.dev`. A read-only
Telegram query confirmed that Worker's `/webhook` and zero pending updates/no
reported delivery error. The matching local archive implements only basic
standalone commands; it does not use HamBazi accounts or game services. A second
local Worker folder is an outbound-only relay and is not the published URL.

Requests from the VPS to the supplied Worker did not pass: Python HTTPS received
Cloudflare HTTP 403/code 1010; a separate curl attempt timed out. There is no
authenticated Cloudflare deployment session on this device. These were initial qualification failures. The owner subsequently published the
prepared gateway. A scoped Node HTTPS transport with standard ECDH groups passed
verified TLS and authenticated SDK probes from the VPS; the default connection
remained unreliable. See the dated operational record. The subsequent forwarding activation and real chat response passed the dated
operational acceptance.

## Decision

Keep the existing Node Bot, private API ports, account/receipt workflows and game
authority on the VPS. Replace the standalone Worker handler with a small
Web-API-only transport adapter owned by `apps/bot`:

1. Telegram sends to the existing Worker `/webhook`.
2. Worker verifies its Telegram secret, bounds input, and forwards the unchanged
   update to the existing authenticated HTTPS VPS Bot webhook.
3. VPS Bot calls the same private Auth/Users application ports and durable receipt
   workflow. Its optional Telegram client calls the Worker at `/v1/<method>`.
4. Worker authenticates the independent relay credential and calls only an
   explicit Telegram method allowlist. It never receives a destination from user
   input and does not retry ambiguous sends.
5. VPS records Telegram acknowledgement before completing the original webhook;
   Worker returns success only after origin completion. Failures remain retryable
   to Telegram; IDs and pending updates are preserved.

Deploy in two stages. With `GATEWAY_ENABLED` absent or `false`, retain the existing
standalone menu and add authenticated egress only. Enable forwarding explicitly
after the new VPS sender and its controls pass live qualification. This lets the
owner publish/test the relay while the existing chat continues working.

Use independent Worker-to-origin and VPS-to-Worker credentials. The existing
token-derived Worker webhook secret can remain during this cutover, so a new
webhook registration is not required. An explicit independent webhook-secret
override is supported for a later coordinated rotation. Nothing rotates or
registers credentials/webhooks automatically.

Add opt-in paired `TELEGRAM_API_PROXY_URL` and `TELEGRAM_API_PROXY_KEY` to Bot-only
configuration. Keep direct mode when both are absent; reject partial/unsafe
configuration. Relay failure never falls back to direct Telegram. The relay URL
and header contain no Telegram token. Preserve strict HTTPS, cancellation,
response-size limits and Telegram flood retry hints. File download/upload and
polling are not added to this JSON-only transport.

The internal Bot API listener remains private. There is no public database,
Redis, administrator or `/v1/internal/bot` route, and no game rule is moved to
Cloudflare. This is an external adapter deployment, not microservice extraction.

## Alternatives

- Merely linking the Mini App from a standalone Worker leaves HamBazi Bot accounts
  and conversations disconnected.
- Moving account state into Worker memory/KV/D1 would create another source of
  truth and bypass the existing durable receipt logic.
- Exposing the existing private Bot API to the Worker would change its explicit
  transport trust model. Reusing the already-public authenticated Bot webhook
  preserves that boundary.
- An outbound-only relay is sufficient if Telegram's webhook stays on the VPS,
  but the owner's current setup already receives updates at the Worker.

## Consequences

Both network directions must work with valid TLS before activation. Preserve the
previous Worker source/version and VPS image/configuration for rollback; qualify
and rebind the changed deployment's finite security controller under maintenance.
No live configuration is changed solely because local tests pass. Cloudflare
publication, VPS container qualification and a real owner-authored chat acceptance
have passed in restricted staging. Full native game acceptance is separate. Production HOLD and the restricted two-account policy remain.

See [gateway deployment instructions](../operations/cloudflare-telegram-gateway.md).

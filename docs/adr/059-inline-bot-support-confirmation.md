# ADR-059: Continue settled Bot support in the same webhook

- Status: Accepted for the requested staging latency correction
- Owner: HamBazi project owner / sole staging operator
- Date: 2026-10-10
- Related: ADR-057, ADR-058
- Supersedes: mandatory Telegram redelivery after every support acknowledgement

## Context

Deployed private staging logs show one real successful support submission taking
15.59 seconds from the first received webhook to final receipt acknowledgement.
The adapter deliberately returned 503 after persisting successful administrator
delivery. The receipt retained its configured 15000-ms lease. Telegram retries
consumed the unchanged identity quota, including a subsequent ordinary request
that waited another 6.10 seconds. Ordinary profile/support-prompt handlers ran
in 74–105 ms; the fresh user-reported successful button sample ran in 76/79 ms.
This establishes an unnecessary support continuation delay, not a general
Mini App/gameplay bottleneck or proof of persistent button latency.

## Decision

The v1 support acknowledgement accepts an optional paired `receiptClaim` object
(UUID receipt ID and positive claim version). Legacy requests and exact response
schemas remain supported. Auth verifies the submission's current admitted sender
and original verified-owner destination. Within one Auth transaction the support
repository verifies the referenced receipt's bot/sender/submission binding,
persists the exact attempt outcome, and releases only a still-live REPLY /
SUPPORT_DISPATCH lease matching that receipt version, advancing the version as required by the existing DB guard. An old acknowledgement
cannot release a newer claim or alter a finished receipt. An explicit support
retry may have its own receipt for the same submission.

After that durable acknowledgement the adapter processes the same original
verified update once more within the existing absolute webhook deadline and
sends/acknowledges the persisted user outcome. It performs at most one
administrator send per webhook and never announces success before confirmed
DELIVERED. FAILED still requires an explicit support-button retry; UNKNOWN never
blindly resends. Failed acknowledgement, continuation, outbound send or deadline
still produces a legitimate retry. No polling, worker schedule, queue or sleep is
introduced; no existing rate limit, admission, TLS, deadline or scan containment
control is relaxed. The extra bounded continuation still spends the existing
identity quota, unlike the former unbounded sequence of unnecessary redeliveries.

Fixed allowlisted Bot timing operations record distributed admission, file
admission, internal process/acknowledgement and outbound Telegram requests, plus
handler duration. Existing correlated API/database timings include DB processing
and pool waiting. A validated Telegram message timestamp yields only elapsed
pre-webhook age, with one-second source precision. Raw updates, timestamps,
Telegram numeric IDs, message IDs, text, profiles and secrets are not telemetry.

## Alternatives

- Shorten the lease or raise quotas: changes safety/abuse controls without removing
  the deliberate retry.
- Return 200 before durable settlement: loses recoverability or can report false
  success.
- Blindly resend after timeout: risks duplicate administrator messages.
- Remove the lease without a version/submission guard: can steal another processor's
  active claim.

## Consequences

No migration/backfill or user registration is needed. New API code remains
compatible with the old Bot; activation/rollback pairs the new Bot with its
matching API. Tests cover immediate continuation, failed/ambiguous outcomes,
explicit retry, duplicate/stale claims, mismatched receipt binding, privacy and
real private HTTPS/PostgreSQL/Redis. Native functional success on the previous
release was reported by the user; native latency acceptance of this correction
requires its own real retest. Production remains HOLD.

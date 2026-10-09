# Staging outage after normal advisory expiry

The account holder reported failed onboarding and Mini App HTTP 503 around
**2026-10-10 01:14 Asia/Tehran**. Native acceptance was **Pending** at the recovery
snapshot; server receipts and synthetic protocol/browser checks did not replace
the account holder's confirmation. The account holder subsequently reported
functional success, followed by a delay-free retest of the
[focused Bot latency correction](2026-10-10-bot-chat-latency.md). That later
release and its evidence are recorded in the current binding; this document
retains the outage/recovery chronology.

## Verified cause

At **2026-10-09 22:35:22 Asia/Tehran (19:05:22 UTC)**, the enabled normal scan-expiry
service successfully applied canonical maintenance and gracefully stopped API,
Worker, Bot and Web. All four exited zero with no OOM. Nginx configuration was
valid, its active routes exactly matched the reviewed maintenance file, and all
three public hosts returned 503. PostgreSQL, Redis and ingress remained running.
This affected the owner and tester alike; it was not a numeric-admission failure.

The original owner file and separate numeric tester policy retained their exact
hashes. The tester ID still matched the earlier verified Telegram update, differed
from the owner, and had no admin grant. The account was still unregistered during
the initial outage inspection. Telegram retained pending updates and reported 503
from the webhook. No webhook polling/reset, backlog deletion or profile backfill
was performed.

## Recovery and validation

Fresh normal scans passed on the same eight exact application/component/data
images. The pinned scanner retrieved genuine advisory data with
`UpdatedAt=2026-10-09T19:06:47.421531537Z` and
`DownloadedAt=2026-10-09T21:48:21.465817257Z`; no timestamp rewrite, exception,
suppression or threshold change was used.

The unchanged clean `81476d2` release was re-prepared in
`/opt/hambazi-staging/private/prepared-staging-restored-20261010` with the same
Compose hash and role configuration. The existing enabled containment timer was
rescheduled to the conservative earliest genuine advisory expiry:
**2026-10-10 22:36:47 Asia/Tehran (19:06:47 UTC)**. Its containment service was
unchanged. The timer was not disabled and the freshness window remains 24 hours.

API, Worker, Bot and Web reached private READY and LIVE under maintenance; exact
pins, UID, private ports and sanitized logs were checked. The reviewed restricted
Nginx routes reopened at **2026-10-10 01:21:33 Asia/Tehran**. No migration, dependency,
application source or game-version change was required. The prior passing root,
integration, contract and packaged-smoke suites remain tied to the same immutable
release; they were not represented as new native acceptance.

Actual public protocol fixtures first confirmed owner entry 200, unregistered
tester `403 REGISTRATION_REQUIRED`, and unrelated identity 401 even with username
`devtest98`. The deployed browser showed the Persian registration screen and
return-to-Bot action without issuing protected product requests.

Telegram retries then delivered the original queued messages. Subsequent real
tester receipts reached DONE for START, explicit REGISTER, PROFILE and SUPPORT_SENT.
The tester completed registration through its own genuine REGISTER message; the
operator created no account or registration. The support record was DELIVERED to
the original owner and the webhook queue returned to zero. Retained webhook error
metadata includes recovery/backlog and the existing durable support retry behavior;
a historical 503 field alone is not a new unresolved outage when delivery is DONE
and the queue is empty.

After that explicit registration, fresh protocol checks confirmed distinct owner
and tester profiles with entry 200, tester admin routes 404 and unrelated admission
still denied. The deployed tester browser reached its profile and personal WSS
without starting or controlling a game. A real tester-owned ACTIVE personal match
was observed separately; completion/native gameplay acceptance remains pending.
The original support destination, regular tester role and registration requirement
remain unchanged.

## Current evidence and retest

The recovery binding is now archived under the current latency correction's
private evidence; its outage reports and hashes remain under
`/opt/hambazi-staging/private/execution-20261008/incident-20261010`. Raw Telegram
updates, IDs, support text, names, tokens and hidden game state are not in this report.

Use the already registered `@devtest98` account: repeat text-only `/start`, verify
profile and Open, continue/finish its personal game, and confirm support receipt
in the original owner's account. Record the actual Telegram version and result.
See [the detailed retest](../staging-test-user.md). Native acceptance was pending
at this snapshot and was subsequently reported successful as described above.
Refresh exact scan evidence before the new deadline under the same operating policy;
otherwise the enabled containment will apply maintenance again. Public/production
admission remains disabled.

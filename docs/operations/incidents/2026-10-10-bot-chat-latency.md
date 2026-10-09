# Telegram chat-button latency correction

The verified staging bottleneck was a mandatory retry after a successfully
delivered support message. The correction is deployed as clean source
`8138d2a2fede95c5e0cd06bfe996eff6249771eb`. Restricted traffic reopened at
**2026-10-10 02:09:10 Asia/Tehran (2026-10-09 22:39:10.544 UTC)**. The account
holder subsequently reported that the real `@devtest98` retest completed without
delay. Native functional acceptance and this latency retest are recorded as user
reports, not an agent-observed Telegram UI test. Telegram client version was not
provided. The separate native Description Picture step remains unchanged.

## Cause and correction

In release `81476d2`, the Bot sent support to the original verified owner and
persisted DELIVERED, then deliberately returned HTTP 503. Its receipt kept the
configured 15000-ms lease. Telegram could not complete the user acknowledgement
until that lease expired. One actual submission accumulated eleven unnecessary
503 responses; these retries spent the existing identity quota. A subsequent
ordinary START was rate limited and took another 6095.24 ms to complete.

The fresh pre-change profile/support-button sample was already fast and the user
reported it worked. The evidence therefore identifies unnecessary support
continuation and retry-induced quota delay; it does not establish persistent slow
profile rendering. Replies use the authenticated webhook directly. No polling,
worker schedule, reply queue or background retry job intervenes.

[ADR-059](../../adr/059-inline-bot-support-confirmation.md) documents the additive
optional receipt claim on support acknowledgement. Auth atomically persists the
attempt outcome and releases only the matching live receipt lease, incrementing
the version required by the existing database guard. The Bot then continues the
same original verified update once within its original deadline and sends the
durable outcome. Duplicate/stale claims cannot release a newer lease. UNKNOWN
never blindly resends; FAILED retains explicit retry. No success is announced
before confirmed delivery. The new successful receipt completed at version 3,
with one support send attempt and no webhook retry.

## Measured before and after

These are actual tester updates, not synthetic Telegram deliveries. Times are
server-side observations; they exclude client rendering and are a small sample,
not percentiles or an accepted SLO.

| Path / metric                                                         | Before `81476d2`                                       | After `8138d2a`            |
| --------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------- |
| Support submission: first durable receipt to final webhook completion | 15594.68 ms, one submission                            | 281.13 ms, one submission  |
| Support submission: full current webhook / handler                    | Multiple retries; no single request covered completion | 290 / 286 ms               |
| Profile: full webhook                                                 | 74, 76 ms, two updates                                 | 110 ms, one update         |
| Support prompt: full webhook                                          | 105, 79 ms, two updates                                | 82 ms, one update          |
| Forced support retry responses                                        | 11 HTTP 503                                            | 0                          |
| Cancellation: full webhook                                            | 56 ms, one update                                      | No new cancellation sample |

The original delayed submission was received at 01:24:02.167 Tehran and completed
at 01:24:17.761 Tehran. The additional pre-change button sample ran at
01:46:50–01:46:54. The corrected actual sample ran at 02:10:39–02:10:52 and
contained START, SUPPORT, TEXT and PROFILE. Only one post-change PROFILE was
observed; requested repetitions are not counted as received updates.

Direct new phase timings:

| Path           | Handler | API process | API support / reply ACK | Database total / calls | Outbound Telegram send     | Full webhook |
| -------------- | ------- | ----------- | ----------------------- | ---------------------- | -------------------------- | ------------ |
| Profile        | 108 ms  | 18 ms       | — / 10 ms               | 19 ms / 5              | User: 77 ms                | 110 ms       |
| Support prompt | 79 ms   | 21 ms       | — / 8 ms                | 19 ms / 5              | User: 47 ms                | 82 ms        |
| Support text   | 286 ms  | 38 + 27 ms  | 15 / 9 ms               | 66 ms / 16             | Owner: 123 ms; user: 70 ms | 290 ms       |

Admission used 2–3 ms at the API and 1 ms at the numeric-file guard for these
three paths. Database durations include query/transaction and pool waiting and
are nested inside API phase durations; do not sum them twice. Outbound phases
measure the awaited Telegram SDK request and response handling, rather than the
client's display time. Before instrumentation, outbound adapter gaps were inferred
from the API process response to the next ACK request: profile 46.27/54.85 ms and
support prompt 82.56/53.64 ms. They are not directly measured Telegram round trips.

New `bot_ingress` samples were 431 ms for profile, 593 ms for support prompt and
950 ms for support text. Their source is Telegram's one-second message timestamp;
quantization is included. They do not prove precise network delay, and no matching
pre-change timestamp baseline exists. No scheduling wait was found on this path.
All timings use fixed allowlisted operations and correlation IDs; Telegram IDs,
updates, text, names, profiles and secrets are absent from this report and telemetry.

## Deployed checks and controls

All four exact application images are healthy under UID 1000. Fresh scans passed
for all eight exact application/component/data images under the normal 24-hour
gate. The existing containment service, timer and deadline are unchanged:
**2026-10-10 22:36:47 Asia/Tehran (19:06:47 UTC)**. No freshness exception,
containment disabling or stale-evidence extension was used.

The original owner and separate read-only numeric tester admission files are
unchanged. Owner/tester admission and unrelated-account denial were verified
through compiled API/Bot policy. The tester remains a regular user; no admin
grant, profile mutation or operator registration occurred. The account's earlier
registration came from its genuine explicit REGISTER update. All durable tester
support recipients remain the original owner. The new submission is DELIVERED
with attempt version 1; owner-chat copy count was not separately reported.

The lease remains 15000 ms, identity quota 10/min and internal request quota
60/min. Webhook maximum connections remains 1, allowed updates remain messages,
and no polling, webhook reset or backlog discard occurred. The post-deployment
window contains four completed webhooks and zero failures; pending updates are
zero. Telegram's retained last error is the historical 01:25:02 Tehran 503 from
the previous release, not a new error. Public Web returns 200; private health,
admin and internal paths remain 404. Text-only START, Open, registration, profile,
support and personal game controls are preserved. Web, Worker and gameplay source
were unchanged. No active Match required a version change at deployment.

Validation passed: frozen install; full `pnpm check`; 81 Bot unit tests; 39 HTTPS
transport cases; full isolated HTTP/PostgreSQL/Redis integration, including guarded
immediate continuation, duplicate/stale/wrong claims and explicit support retry;
44 packaged checks and two browser smoke cases; zero dependency/secret findings.
One existing infrastructure test remains skipped. Fifteen existing migrations and
twelve contract baselines are retained; no migration or backfill ran on staging.
Production remains HOLD and successor rollback acceptance is not claimed.

The [current deployment binding](../../../infra/docker/staging/staging-test-user-current.json)
records source/image/Compose hashes and private evidence. The previous recovery
binding is archived with its own hash, so historical protocol checks are not
misrepresented as new tests. Private safe evidence is under
`/opt/hambazi-staging/private/execution-20261008/bot-latency-20261010`, including
`baseline-summary.json`, `after-native.json`, `after-summary-v2.json`,
`operational-closeout.json`, `unchanged-controls.json` and the evidence index.

## Exact Telegram retest

The account holder completed the requested retest and reported no delay. For a
repeat with `@devtest98` in private `@Hambazidev_bot` chat:

1. Press «پروفایل من» twice, two seconds apart.
2. Press «ارتباط با پشتیبان» and send one short test text.
3. Check the delivery confirmation, then press «پروفایل من» again.
4. Have the original owner check that one copy arrived. Record Telegram version
   and observed delay separately from server timings.

This does not register an account or grant additional access. Unrelated accounts
remain denied. The broader Mini App/gameplay flows were already reported successful;
no additional game or Mini App performance work was undertaken.

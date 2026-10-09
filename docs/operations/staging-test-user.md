# One regular staging test user

The owner explicitly admits `@devtest98` as one ordinary staging tester under
[ADR-058](../adr/058-narrow-staging-regular-test-user.md). The
[current deployment binding](../../infra/docker/staging/staging-test-user-current.json)
records clean source `81476d2`, four exact application pins and private evidence.
The preceding onboarding and personal acceptance bindings remain historical.
Public admission and production release remain disabled.

## Identity and registration

The numeric identity was observed from an original recent private `/start` on the
existing secret-verified HTTPS Telegram webhook, after the account holder confirmed
sending it. Minimal provenance is retained in private operator storage. The separate
mode-0600 tester file contains only that numeric ID, mounted read-only in API and
Bot. The temporary username observer was removed from the final configuration and
its container was gracefully recreated. Changing a username grants no admission.

The original single-owner file is unchanged. Its identity remains the support
recipient and sole operator. The tester has no administrator role or credentials;
Admin is still unimplemented/disabled and its public paths return 404. This exception
allows existing ordinary product features, subject to registration and per-user
personal-game ownership. It does not activate ordinary multiplayer or the main catalog.

Admission and `/start` create no profile. At admission, the tester had no profile or
completed registration. The actual public registered-session route returned
`REGISTRATION_REQUIRED` for a fresh signed numeric tester protocol fixture; unrelated
numeric identities were denied even with username `devtest98`. No synthetic Telegram
update or live registration was used. Explicit registration must come from the user.

## Native Telegram retest

Use `@devtest98` in private chat with `@Hambazidev_bot`:

1. Send `/start` again. Expect only «برای ادامه، از دکمه‌های پایین استفاده کن.»,
   no photo, and «ایجاد حساب کاربری» while unregistered.
2. Press Open before registration. The Mini App must require registration in the Bot.
3. Explicitly press «ایجاد حساب کاربری». Verify «پروفایل من», then Open at
   `https://staging.hambazi.top/`. Registration is never done by the operator.
4. Start and finish the existing personal Coup game against server bots. The other
   admitted human must not read or control this match.
5. Press «ارتباط با پشتیبان», send a short test text and check the acknowledgement.
   Confirm receipt in the original owner's account. Test cancel and unsupported
   media if checking the existing support regressions.
6. Repeat `/start`: the same text-only reply must show profile/support buttons.

Record the Telegram version and actual user report separately from automated
protocol/browser fixtures. Until a report arrives, native tester acceptance is
pending. The preceding owner's accepted iPhone flows are not this account's acceptance.
The native Description Picture procedure remains in [Bot onboarding](bot-onboarding.md).

## Operator and revocation

The active preparation is
`/opt/hambazi-staging/private/prepared-staging-test-user-20261009`.
Private evidence and the separate tester policy are under
`/opt/hambazi-staging/private/execution-20261008/staging-test-user-20261009`.
The preparation runner is `runner-81476d2`; the existing generic containment runner
and sole operator remain unchanged. No migration or backfill was performed;
the existing fifteen migrations, grants and twelve contract baselines are retained.

To revoke, enter the existing maintenance procedure and remove the single numeric
entry from `staging-test-admission.json`, retaining the schema/purpose and an empty
`telegramUserIds` array. Preserve the mounted file inode: write/truncate and fsync
the existing private regular file while retaining uid 1000, mode 0600 and nlink 1.
An atomic rename of the host file alone does not update an existing bind mount.
Alternatively re-prepare and gracefully recreate the paired services under
maintenance. Verify the tester's existing session and personal commands are denied
and original-owner admission remains valid before reopening restricted traffic.
Never replace or expand the owner file to revoke or admit an ordinary tester.

Normal fresh eight-image scans passed with no freshness exception. The installed
containment deadline remains **2026-10-09 22:35:21 Asia/Tehran (19:05:21 UTC)**;
it was not extended. The old exact-pair acceptance tool is historical and cannot
accept this two-human successor. Rolling back to code without the exception must
remain under maintenance until reviewed current compatibility/admission evidence.

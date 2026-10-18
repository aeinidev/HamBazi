# Continuous restricted staging after the four-hour Kahroba window

The owner requested permanent test availability on 2026-10-19 Tehran time.
Normal automatic renewal continues until the owner revokes it. Owner plus one
numeric tester admission and production HOLD remain unchanged.

## Cause and scope

The subsequent Kahroba lobby deployment installed
`zzzz-kahroba-lobby-271ee6-fixed-four-hours.conf` and disabled the hourly renewal
timer. Its explicit scan deferral expired on **2026-10-18 21:44:38 UTC /
2026-10-19 01:14:38 Tehran**. The original containment service applied maintenance
at `2026-10-18T21:44:39.173Z` and gracefully stopped the four apps. The normal
renewal state still recorded a later deadline, but the four-hour override took
precedence. This was intentional scheduled containment.

The deployed API, Worker and Web remain the exact `271ee6e282ab1622dd97261912f0619d2fc7a052`
images; Bot remains its existing `1bfc42e50c6f7b3f1a27168df22c99018356ab18` image.
No application rebuild, version rollback, registration, migration or backfill was
performed. The earlier preservation diagnostic was resolved by the deployment's
full-row multiset check; it was not an unresolved reason to keep Worker stopped.

## Security and capacity repair

Fresh official advisory data revealed High **CVE-2026-88806** in ingress `libx11`,
plus four Moderate findings in `libx11`/`libxpm`. All seven other images passed.
The initial fresh-database download also failed because only about 1 GB of disk
space remained. Three expired, regenerable scanner caches were removed after
retaining their metadata, database SHA-256 and sizes: **4,375,351,754 bytes**.
No image, application data, backup, release report or credential was removed.

The ingress-only build installs official signed Alpine `libx11 1.8.14-r0` and
`libxpm 3.5.20-r0`, retaining the previous `libexpat 2.9.0-r0` repair. Alpine's
[official security database](https://secdb.alpinelinux.org/v3.24/main.json)
identifies these fixed versions. The exact retained base, APK URLs and hashes
remain in `component-lock.json`. Package installation was offline with signature
verification. Nginx's executable is unchanged.

Clean source: `cc02cdb2d1cab90e79471545de06ef7658381341`, retained on branch
`codex/staging-continuous-20261019`. Patched ingress:
`hambazi-staging/ingress:cc02cdb2d1cab90e79471545de06ef7658381341-9207d35db327442e@sha256:653b9bbc8fe3e9870b73558672bcf106aedc2db349d8d499f2fef28042134e40`.

All eight exact runtime/component images pass the unchanged normal 24-hour
freshness and High/Critical/Unknown gates. Ingress and ACME have no findings;
the six retained application/data images each have one permitted Moderate.
The four-hour scan deferral was not extended or converted into a recurring waiver.

## Continuous operation

The expired four-hour override was archived outside systemd. The canonical
containment service remains byte-identical and enabled through its normal timer.
The hourly authority was rebound to the current exact images, container IDs,
role files and reviewed Kahroba restricted routes. Its implementation, scanner,
thresholds and schedule are unchanged.

A separate private Compose observation combines the deployed three-role
preparation with the retained Bot definition. It is used only by the existing
read-only operator checks; it was not used to deploy or recreate applications.
Historical preparations and expired deferral evidence remain unchanged.

The same Worker, API, Bot and Web containers were started under maintenance,
consumer before producer. All reached healthy and private LIVE/READY 200.
Full canonical-row aggregate hashes for users, games, matches, events, receipts,
outbox, results, statistics and all 15 migrations match before/after startup.
Only ingress was recreated. Database and Redis IDs/start times are unchanged.
The reviewed routes reopened at **2026-10-18 22:24:40.344 UTC /
2026-10-19 01:54:40.344 Tehran**.

All seven current containers now use `unless-stopped`, and Docker is enabled at
boot. This changed only their restart policy, without restarting or recreating
them. An explicit containment stop still leaves them stopped. Both timers are
enabled and persistent; this operation did not reboot the host.

The normal security deadline at activation is **2026-10-19 18:32:29 UTC /
22:02:29 Tehran**. This is an evidence window, not an end date for the owner's
authorization. Passing newer evidence advances it automatically. Failed security
checks still preserve containment; indefinite availability is not a waiver of
those checks. Revocation follows the existing automatic-renewal runbook.

## Verification and evidence

The installed systemd renewal service completed real eight-image scans at
`2026-10-18T22:26:20.793Z` with exit zero. Its result was `unchanged` because
the same genuine advisory timestamp still supports the installed normal expiry.
Original containment was also successfully exercised against the repaired ingress
while maintenance was already active. Per-image TLS renewal provenance remains
valid; certificate issuance was not run.

Final public checks pass: Web and its JS/CSS assets return 200; anonymous profile
and Kahroba capabilities return 401; catalog, ordinary rooms, admin, health and
metrics remain hidden with 404. CSP, no-store and certificate verification pass.
All four apps remain LIVE/READY 200. Telegram has zero pending updates and no
delivery error after reopening; its retained 503 is from
`2026-10-18T22:24:35Z`, before traffic opened. No webhook reset, fabricated
update, message send or backlog drop was performed.

The exact build, image scan, Nginx parser and live operator checks validate this
operational repair. No application source was changed or built; a full application
suite or native two-player Telegram acceptance is not claimed.

Private evidence is retained under
`/opt/hambazi-staging/private/execution-20261008/continuous-staging-20261019/`:
the failed old-image scan, passing replacement scan, clean manifest, prior policy
and timer files, cache metadata, preservation hashes, deployment, startup,
activation and final service/public/Telegram verification. The live normal state
and last successful scan remain authoritative after subsequent hourly runs.

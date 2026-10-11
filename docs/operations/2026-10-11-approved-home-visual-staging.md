# Approved home visual revision — restricted staging deployment

## Result

The owner approved the current UI and authorized the existing restricted staging
VPS deployment. Revision `685d9f6683fef8e06197622b4c695a145c7b8c94` was deployed
to `https://staging.hambazi.top/` at **2026-10-11 14:54:11 UTC / 18:24:11 Tehran**.
Only Web was replaced. Production was not accessed or changed.

Web image:
`hambazi-candidate/web:685d9f6683fef8e06197622b4c695a145c7b8c94-9dbdc0ed38d35807@sha256:dc60073323acefc0e8d05be213291856810c02866797b6ffed512beba1196c06`.

The approved branded loading shell, responsive home, seven separate illustrations,
live Persian controls and self-hosted Vazirmatn font are served from this image.
Only Coup opens; the five future games and unavailable features remain disabled.
Settings, Profile, authenticated identity and existing Coup presentation retain
their behavior. The [visual review](../design/home-visual-revision-review.md)
lists the approved source/assets and remaining differences from the reference.
No additional product feature was implemented during deployment.

## Preservation and deployment method

The verified target is the existing `185.110.191.104` VPS, Docker daemon
`342f251a-9e56-4353-af12-a32429b7a2e7`, Linux/amd64. The original owner and one
numeric admitted tester remain the only admitted identities. Admission files,
all four role files, ingress routes, access/limits, expiry service and timer
drop-in stayed byte-identical. No BotFather, DNS, public routing, authentication,
credential, database migration, backfill, contract, engine or worker change ran.

The established packager built a clean four-role candidate and its normal scans
passed. Only the Web archive was imported for deployment. The normal preparation
tool validated the candidate against the existing private inputs and compatibility
hashes. A separately recorded Compose overlay starts from the previous running
definition and changes exactly `services.web.image`. Every other service field,
mount, environment reference, resource limit, network, private address and health
configuration was compared for equality. The Web non-client filesystem, including
its server/security code, was also byte-identical to the previous Web image.

The regular preparation format assumes a uniform source commit. This rollout
therefore records both clean source inventories and each actual role pin; it does
not present the mixed runtime as a uniform-source release. API/Bot/Worker remain
`1bfc42e`, Web is `685d9f6`. The full new candidate preparation is validation
evidence only and must not be used for a four-service rollout.

Actual overlay: `/opt/hambazi-staging/private/prepared-approved-home-web-685d9f6`.
Evidence: `/opt/hambazi-staging/private/execution-20261008/approved-home-685d9f6`.
The [current staging binding](../../infra/docker/staging/staging-test-user-current.json)
records the exact pins, overlay/preparation hashes and private evidence hashes.
The installed operator and generic containment runners were unchanged.

The Web-only Compose command used `--no-deps`, `--pull never` and readiness wait.
API, Bot and Worker container IDs, image IDs and start times stayed unchanged.
Ingress, PostgreSQL and Redis were not restarted. There were zero active matches
at deployment; the 46 existing matches and their engine/schema/ruleset pins were
preserved. Final counts are **2 users, 2 registered users, 47 matches, 0 active
matches, 15 applied migrations**. The extra match is the completed gameplay smoke.
The smoke session was logged out; no account was created or reset.

## Verification

Passed before deployment:

- 87 Web unit tests; clean commit and source snapshot; no retired URL or old
  opening-message reference in the approved source or packaged JS/CSS/HTML.
- Normal dependency audit and secret scans of current files/history: no findings.
- Four exact candidate image scans; normal severity and 24-hour freshness policy.
- Actual packaged runtime smoke: 46 checks and 2 browser cases, including CSP,
  memory/storage privacy, signup/account idempotency, profile and static delivery.
  Two initial attempts failed the pinned SDK fixture gate; the successful rerun
  used the candidate's exact self-hosted official SDK bytes and the existing SRI
  check. No SDK pin or application code was changed to make the tests pass.
- Eight exact target runtime images rescanned using a fresh, separate advisory
  cache: retained API/Bot/Worker, new Web, ingress, ACME, PostgreSQL and Redis.
  The existing cache initially reused older metadata; those results were archived
  and superseded before deployment. Final database update was
  `2026-10-11T13:06:05.155544028Z`, download `2026-10-11T14:53:06.12782468Z`.

Passed after deployment:

- Actual deployed Web captures at **320×568, 375×667 and 390×844**, in Chromium
  and WebKit. Loading, font/art decoding, RTL two-column ordering, proportions,
  no horizontal overflow, fixed navigation and final-row scroll access passed.
  Chromium fetched HTTPS directly; WebKit used a TLS-verified request adapter.
  Authentication and socket traffic in these browser captures use synthetic
  transport fixtures; the actual deployed Web/SDK/assets are unmodified.
- Served HTML and all 18 checked bundle/font/art/role-asset paths matched the
  packaged SHA-256 bytes in both browsers, with `Cache-Control: no-store` and
  restrictive CSP. All seven retired poster URLs returned **404**. Fresh browser
  contexts made no retired poster request. No service worker was introduced.
- Home/Profile/Settings navigation, disabled future routes and controls, live
  name/fallback rendering, Coup entry/start/table, role details, legal controls
  and simulated Telegram ready/fullscreen/safe-area bridge behavior passed.
- A real restricted staging API/WSS/Worker/PostgreSQL/Redis gameplay smoke passed
  **33 checks** using a fresh, synthetic signed launch for the already registered
  admitted tester. It completed one Coup game with six tester commands, retried
  start and a command idempotently, disconnected/reconnected, verified the saved
  name in the authorized player projection and contiguous durable event sequence,
  then checked that admission was freed and the profile and existing pins remained
  unchanged. A pre-existing tester match would have been left untouched. The
  helper initially lacked compiled engine files in the operator checkout; the
  successful run used the exact engine from the running API image via private
  Docker execution, without changing that image/container.
- Signed unadmitted identity, unauthenticated profile/socket and foreign-origin
  socket attempts were denied. All five future-game API starts returned 404;
  ordinary catalog, Friends, Leaderboard, Admin and private health routes remained
  unavailable publicly. Public HTTPS route probes independently passed.
- All four private readiness probes returned 200/READY, Docker health was healthy,
  and allowlisted final log samples had no warning/error records. Controls and
  retained release hashes were checked again after gameplay.

The [deployed capture gallery](../../test-results/staging-approved-home-685d9f6/index.html)
contains loading, initial/scrolled home and Coup captures. These ignored local
artifacts are not shipped with the application. The previous local browser,
lint/typecheck/architecture/build results remain in the approved visual review;
the full root check was not rerun for this Web-only deployment.

## Rollback readiness

Both the previously running **`1bfc42e`** release and the older **`4b154f1`**
rollback candidate retain their four exact image pins and unchanged preparations.
No images, data volumes, queues or release preparations were pruned.

The immediate rollback is Web only, using the previous running preparation:

```sh
docker compose --env-file /dev/null --project-name hambazi-preparation \
  --file /opt/hambazi-staging/private/prepared-home-entry-20261011/compose.yaml \
  up --detach --no-deps --pull never --wait --wait-timeout 90 web
```

This exact definition was validated and its Web image is present. It keeps the
current API/Bot/Worker and durable state. Recheck the normal scan gate and controls
at execution time, then rerun Web/readiness smoke and update the binding.
An automatic Web-only rollback was armed for a failed rollout readiness wait and
was not needed. **No live rollback was executed.** These checks do not certify a
future rollback of backend engines, database schemas or queued jobs.

## Remaining limitations

- Native Telegram device checks are still unobserved. Actual browser/SDK loading
  and bridge requests passed; Telegram's native pre-page placeholder, device safe
  areas, Bot signup/direct invite and genuine photo rendering require the admitted
  users' device evidence. The earlier owner commitment to provide that evidence
  remains pending. No raw initData/token was persisted or logged by the smoke.
- A genuine verified Telegram photo URL has not been supplied/tested. The existing
  signed-photo restriction and fallback were preserved; no client URL trust was
  added. The fallback passed browser checks.
- An already open Mini App may keep its previous JavaScript in memory until it is
  reopened. Fresh contexts fetch the new fingerprinted bundle; the server does
  not serve retired poster files. No forced refresh interrupted a game.
- Trivy reports the moderate, fix-available `CVE-2026-85091` for zlib in app/data
  images. It is permitted by the unchanged policy; no high, critical or unknown
  findings were present. Dependency/base-image remediation was outside this
  approved visual deployment.
- The existing enabled containment deadline remains **2026-10-12 07:05:14 UTC /
  10:35:14 Tehran**, conservatively earlier than the fresh scan's expiry. It was
  not extended or disabled. Existing restricted staging limits and production
  HOLD remain in effect.

Deployment and verification stop here. No additional phase is authorized.

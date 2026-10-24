# Fantasy main lobby deployment — 2026-10-23

The owner requested publishing the reviewed lobby design to the existing server.
It is live at <https://staging.hambazi.top/> on **89.46.217.9**. Activation completed
at `2026-10-23T15:41:54.349628+00:00` (19:11 Tehran).

The account header clears Telegram's native controls. The existing banner image
and wordmark are preserved; three activity rows replace the marketing copy and
yellow CTA. At the owner's explicit choice, counts remain `—` until real live
statistics are connected. The fixed five-item dock and header controls use a new
transparent sculpted icon atlas. The unconditional home recovery link is removed.
See [the design record](../design/fantasy-main-lobby.md) for behavior and scope.
Friends, chat, leaders and notifications retain disabled coming-soon semantics;
this release does not implement those services or automatic active-game discovery.

## Release identity

- Web source snapshot commit: `1b62679a6396699505a676148497e325b90414d8`.
- Source archive SHA-256: `97de795d4a86c65a7299d4ca240515e7df3474c6cfcb4a26d1437f3bf5eafd07`.
- Build input SHA-256: `1a95c13fe13e51aa3ac38c86a0140558a24d43fc5ac73d4a9130f7ed4b68fc5f`.
- Web image: `hambazi-fantasy/web:20261023-1a95c13fe13e51aa@sha256:a43b247cdab89ab0b2777f0596e5d00ef2818aeb3b0cafe78b1f97b17e047b92`.
- Parent: the preceding qualified compact Web release.
- Existing ingress, browser security policy, lockfile, other application sources,
  admission and database schema are retained.

The isolated source snapshot includes existing local changes without moving the
working branch or staging index. An offline frozen install and uncached Web and
dependency production builds passed with Kahroba enabled. The built public file
inventory contains 51 files; secret scanning reported zero findings. The exact
candidate image passed an isolated nonroot, read-only static/health/cache probe.
Fresh exact-image scans passed for all six active role pins and the rollback Web
image under the existing policy. Security control rebinding and private readiness
passed; renewal and independent expiry timers remain active. The observed deadline
is `2026-10-24T13:13:41Z`; later renewal may advance it.

## Active match and activation

A predeployment read found one active game. The owner explicitly requested ending
it. An operator-only invocation of the existing public Match processing lifecycle
used a stable action ID and expected state version to commit `TERMINATED`, its
append-only lifecycle event, processed-command receipt and outbox atomically.
No engine state was edited directly and no fabricated winner/statistics were
created. A subsequent check confirmed zero nonterminal matches. Earlier candidate
navigation correctly recovered that active table; after its termination the
candidate's normal lobby/navigation checks passed. Unneeded gameplay diagnostic
capture was removed.

Cutover used the existing maintenance/drain procedure after the zero-active-match
check. A private custom PostgreSQL backup archive was created and its listing
verified; no restore rehearsal or offsite backup is claimed. Only Web was
recreated. API, Worker and Bot were drained and restarted using the same exact
containers/images. PostgreSQL/Redis, durable records, migrations and admission
were preserved. No migration, Telegram configuration or ingress change was made.
Rollback material is retained; rollback was not required.

## Verification

- Web typecheck, scoped lint, formatting and architecture checks passed.
- All 124 Web unit tests passed. The 112 distinct Midnight browser cases are
  covered: the full run passed 111; a missing wait in the new header test was
  corrected and both affected engine cases passed on focused rerun.
- Actual production candidate and postdeployment HTTPS checks passed in Chromium
  and WebKit. They verify all five menu labels, fixed dock through scroll, last
  card access, decoded atlas, absent old CTA/recovery link, placeholder metrics,
  settings navigation, Kahroba lobby/create/help/settings and authenticated WSS.
- Real HTTPS verifies no-store HTML, Brotli/immutable JS/CSS, ETag/304, unauthenticated
  profile 401, cleaned launch URLs, memory-only credentials and zero fatal errors.
  These checks create no rooms, games or chat messages.
- An additional local infrastructure sweep passed 302 tests and skipped four.
  One existing deployment-fixture test failed at `CI_GATE_FAILED:deployment-test-private`
  while creating its temporary Docker network; a focused rerun reproduced it.
  No fixture or gate was weakened. Exact-server qualification, activation, readiness
  and postdeployment browser checks above passed independently.
- Native Telegram device acceptance and full multiplayer play-to-finish/load/soak
  checks remain separate; backend/engine behavior is unchanged by this Web release.

Current pins are in [deployment.json](../../infra/docker/server/deployment.json)
and [compose.yaml](../../infra/docker/server/compose.yaml). Private release evidence
is under `/opt/hambazi/releases/fantasy-lobby-20261023`; local evidence is under
`/home/mehdi/.cache/hambazi-fantasy-lobby-release-20261023` and ignored screenshots
under `test-results/fantasy-lobby-release-20261023`.

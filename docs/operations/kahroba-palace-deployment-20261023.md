# Kahroba palace lobby deployment — 2026-10-23

The owner-authorized palace lobby is deployed on **89.46.217.9** at <https://staging.hambazi.top/>. The main HamBazi Kahroba card is available to the existing admitted accounts and opens the real palace lobby. The separate “میز خصوصی کهربا” entry and its floating styles are removed. Other games keep their existing availability.

Private/public capacities 2/3/4, invitations, readiness, explicit host start and durable public-search recovery use the real API/Worker implementation. Existing admission still contains two identities; this release does not enroll new users or claim four-human native play on that two-account cohort.

## Source and images

- API/Worker source: `6da9f12eb8a2fb99020b5d57960c9deaaa5b7217`; snapshot `a29353ca34c0c7f6a2414c6f08ad1741d65b111edde0abdc9d3df992253487e7`; build input `d4902d5b5d3b0f1f79ae0007aab492490e8d5acd95908ce46fe8a010ed7b3820`.
- Final Web source: `b792c325667fe34ded68d72e432ae1b3f0db8fb2`; snapshot `69b47fec2531482c9a570196560ec41c079ac9d05417ce0ba4de62a3cb1025d0`; build input `6f5fdebedbd2d70a537c95f7c2c9c6cc7613e8b43ae18616454ba19283301973`.
- Initial activation: `2026-10-23T09:28:36.144221+00:00`; Web correction: `2026-10-23T09:42:22.887119+00:00`.

The first immutable candidate used the repository's Docker build tooling, frozen lockfile, exact base/package pins and verified sealed build artifacts. The local feed certificate had expired; a new local CA/leaf was issued without disabling TLS, artifact hashes, package signatures or supply-chain checks. The received digest-only OCI archive lacked import tag names. Only its import envelope names were restored from the build manifest; every content-addressed blob was independently hash-verified unchanged and the original archive retained.

Live WebKit inspection found that Kahroba's default Socket.IO polling conflicted with the existing WebSocket-only ingress. The final Web correction explicitly uses WebSocket transport for that gateway, preserving the generic transport. Its production build used the same pinned lockfile/runtime tooling and staging browser policy. The artifact contains an exact hash inventory of all 41 client files. The final Web image derives from the already qualified palace Web image, replaces only the client directory and records the new source/build hashes in its labels. API, Worker, Bot and data images were unchanged by that Web correction.

Current exact image pins and per-role sources are in [deployment.json](../../infra/docker/server/deployment.json) and [compose.yaml](../../infra/docker/server/compose.yaml). The working tree and its existing changes were preserved; source commits are isolated release snapshots, not commits on the user's active branch.

## Cutover and security

Cutovers confirmed no active Match, entered the existing maintenance route and gracefully drained applications. Private custom-format database archives were created and their listings verified. The existing PostgreSQL volume, users, matches and all 15 migrations were retained; no migration, admission file, credential, Bot gateway or Telegram setting changed. These local archives are not an offsite backup or a rehearsed restore.

Signed Alpine musl fixes were retained on application images. Fresh exact-image scans passed the installed gate for all six active images; previous application/Web images were separately scanned for rollback. No High/Critical/Unknown findings were accepted; permitted Moderate/Low findings remain. Actual image/container identities and the explicitly changed Compose hash were reviewed and rebound. All other file bindings were preserved. Four strict private READY checks and the complete control verifier passed before reopening nginx. Both the hourly renewal timer and independent expiry timer remain active. The observed finite deadline is `2026-10-24T07:12:39Z`; consult server state for later renewals.

No rollback was needed. Previous qualified image pins, source/input manifests, archives and private operational evidence remain under `/opt/hambazi/releases/kahroba-palace-20261023`, including the `websocket-correction` subdirectory.

## Verification

- API unit/contract/service tests: **1,015 passed**; Web unit tests: **124 passed**.
- API/Web types, lint, architecture, formatting, build and contract checks passed.
- Actual-main Chromium/WebKit private/public browser integration passed all four scenarios before the transport correction. After the correction, the combined run passed three scenarios and failed at the existing private Chromium game-summary-to-lobby return step. The unchanged focused rerun passed in **38.65 seconds**; all four distinct corrected-transport scenarios therefore have positive evidence across runs. The final combined invocation is not reported as entirely green. The asynchronous roster assertion now waits for all three real members rather than sampling before the lobby query resolves; forged-launch testing follows automatic authentication and still requires rejection.
- Disposable database foundation: **17 passed**; actual Worker integration: **3 passed**. Earlier local attempts during image construction encountered isolated-container startup/cleanup failures; the subsequent integration runs completed.
- Production HTTPS checks passed for **both existing admitted accounts**: Kahroba main availability, max capacity 4, creation permission, current private room and public-search reads. Other dormant games remained unavailable. Unauthenticated availability returned **401**. The initial internal HTTP diagnostic was correctly denied by the production HTTPS rule; final checks use real HTTPS.
- Final deployed **Chromium and WebKit: 2 passed**, each confirming the main card, absence of the separate entry, palace rendering with both hero/background images decoded, capacities 2/3/4, authenticated Kahroba WebSocket namespace connection, no online counter, no horizontal overflow, no fatal page errors, scrubbed launch URL and no credential storage.

Deployed browser checks use the real pinned Telegram SDK, real HTTPS/API and fresh signed launch data for an existing admitted account. Credentials stay in memory and are not included in reports. They do not create live rooms or games, fabricate players or send Telegram messages. Screenshots are retained in ignored `test-results/kahroba-palace-lobby-20261023/deployed-*.png`.

Full native Telegram multiplayer gameplay, new user enrollment, four-human live staging play, load/reconnect storm, soak, backup restore and production launch acceptance are not claimed. Existing broader staging limitations remain separate from this release.

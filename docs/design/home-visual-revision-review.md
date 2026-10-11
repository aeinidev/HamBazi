# Home and loading visual revision — review required

Owner review update, 2026-10-11: the current UI implementation and artwork were
approved. Deployment to the existing restricted staging environment was
subsequently authorized. The local review record below describes the evidence
available at the time of that review; deployment evidence is recorded separately.

Date: 2026-10-11. Local implementation only. No staging/production deployment,
BotFather change, access-control change, or cache purge was performed.

## Review artifacts

- [Interactive review, all three sizes](../../test-results/visual-review/index.html)
- [Separate artwork sheet](../../test-results/visual-review/artwork-sheet.png)
- Reference/home comparisons: [320](../../test-results/visual-review/comparison-320.png),
  [375](../../test-results/visual-review/comparison-375.png),
  [390](../../test-results/visual-review/comparison-390.png)
- [Loading screen at 320/375/390](../../test-results/visual-review/loading-sizes.png)
- Unmodified browser captures are in `test-results/visual-review/chromium/` and
  `test-results/visual-review/webkit/`. They include initial viewport, scrolled
  viewport, full page, and pre-JavaScript loading. Full-page browser captures can
  show fixed navigation over content at its initial scroll position; the paired
  viewport captures show actual scrolling and final-row access.

The comparison reference is a CSS viewport over the unchanged approved image:
x=50, y=90, width=842, height=1560, scaled to each comparison width. This omits
the main outer frame/status bar; phone-edge slivers and the home indicator remain
only in the reference. The reference is included
only in the review directory, never in the production/public asset inventory.
Browser captures use the existing synthetic authenticated-session/profile and
transport fixtures. They are not native Telegram or live-server evidence.

## Implemented changes

The former unstyled `Opening HamBazi…` HTML placeholder is replaced with a
navy/cyan/purple live HTML/CSS/SVG loading shell. The automatic sign-in wait uses
the same shell. Initial personal Home/Profile rendering waits for `/v1/me` so a
guessed identity is not shown. Authentication and profile failures leave the
loader and expose retry; missing/expired launch and registration keep their
existing explicit flows. There is no minimum duration or artificial delay.
Direct Coup entry/reconnect keeps its existing admission flow.

All six posters and the four-player banner were reconstructed from the approved
reference with seven distinct built-in `image_gen` calls. Art is separate from
live labels and controls. Subjects, bright palette, composition, card order,
left-aligned games heading, outlined SVG icons, gradients and navigation glow
follow the reference. Banner aspect ratio is 2.17; successive card rows use
1.82, 1.77 and 1.63 to follow the reference's slightly taller bottom row.
Home/loading use self-hosted Vazirmatn v33.003; the existing Coup UI keeps its
supplied display font.

Coup alone opens the existing entry. Future games, Friends, Leaderboard, banner
CTA, all-games control and notifications stay disabled. Settings and Home/Profile
retain their existing routes. The actual authenticated name and session-scoped
Telegram photo/fallback remain the identity sources. No engine, server admission,
account service, match state or public contract changes were made.

## Loading ownership

Our HTML, SDK wait, automatic authentication wait and initial home-profile wait
are app-controlled and now use the new shell. Telegram's native placeholder
appears before the page is displayed. React cannot replace its markup/animation,
native close/menu controls, or OS status/navigation bars. Telegram supports splash
icon and light/dark colors through BotFather; those settings are unchanged.
The existing early `WebApp.ready()` call hides Telegram's placeholder once the
essential interface is available. See the
[official Telegram documentation](https://core.telegram.org/bots/webapps).

## Remaining visual differences

- The generated artwork matches the subjects/composition closely, but faces,
  costumes, card ornament, gem facets, dice/pip patterns and background details
  are reconstructed rather than identical source artwork. The replacement art
  is somewhat brighter and has more background bokeh. These need owner review.
- Vazirmatn is an approximation of the reference typeface; no original reference
  font was supplied. Home no longer uses the older irregular display font.
- Explicit MVP “به‌زودی” labels are added to future cards and disabled banner/nav
  controls. The reference's fictional avatar/name is replaced with the real
  authenticated identity. No fabricated notification count or online indicator
  is displayed.
- Navigation stays at the viewport bottom. The 390 × 844 viewport is taller than
  the reference content aspect ratio and consequently has more navy space above
  navigation. Smaller viewports scroll. Telegram safe areas are applied when the
  real bridge supplies them; the comparison captures have no synthetic phone
  frame or OS chrome.
- No loading-screen composition was supplied beyond the home reference palette;
  the loading mark, typography and indeterminate indicator are a matching new
  design for review.

## Asset/cache verification

Seven retired posters were removed from `public/assets/midnight/`. All home art,
Coup entry and the existing shell background now reference the new
`public/assets/home/<name>-<SHA-256 prefix>.webp` files. The final JS/CSS/HTML
artifact contains no old poster URL or old launch-message references.

The actual production static server was run locally against the final build:
all seven retired URLs returned 404; all seven new assets returned 200 with
`Cache-Control: no-store` and bytes matching their recorded SHA-256 values.
The new HTML references freshly fingerprinted JS/CSS. No service worker was
introduced; the existing browser policy disallows workers. Fresh browser
contexts request only the new home asset paths.

Existing staging still serves its previous release because this revision has
not been deployed. Its old visuals are not evidence of a cache failure in this
new local artifact.

## Tests and limits

Passed:

- `pnpm --filter @hambazi/web test`: 87 unit tests.
- `pnpm --filter @hambazi/web typecheck`.
- `pnpm lint`, `pnpm check:architecture`, `pnpm format:check`.
- Web production `build`, with the existing staging destinations compiled for
  the local mocked-browser fixture; preview-boundary verification passed.
- `test:browser --config midnight.playwright.config.ts lobby.spec.ts visual-revision.spec.ts`:
  48 Chromium/WebKit tests for live identity/photo, disabled routes/actions,
  Coup entry/resume/idempotency, registration gating, settings, accessibility,
  keyboard/fallback font, loading and auth/profile retry.
- After the final proportion adjustment, the 14 affected mobile/RTL/font/loading
  capture tests passed in both browsers at 320 × 568, 375 × 667 and 390 × 844.
- The broader run also passed the 30 existing Coup table tests and 8 native-bridge
  presentation tests. Initial WebKit pre-JS screenshot harness timeouts were
  fixed by blocking the bundle without leaving document loading pending; the
  final tests above pass. No local test remains blocked.
- Actual static-server inventory/cache/hash check described above.

Native Telegram signup/invite, native pre-page appearance, and real signed photo
URL evidence remain pending the owner's device checks from the prior task. The
photo restriction is unchanged in this visual revision. API/database integration
tests were not rerun: server admission and durable write paths did not change.
Staging smoke was not run for the revision because deployment is explicitly
withheld pending visual review.

## Changed files and migration

| Files                                                                                 | Purpose                                                                                 |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/web/index.html`                                                                 | Initial branded loading markup, Persian metadata and self-hosted font preload           |
| `apps/web/src/ui/launch.css`, `loading.tsx`                                           | Shared startup/loading presentation and reduced-motion behavior                         |
| `apps/web/src/features/auth/index.tsx`                                                | Branded automatic authentication wait                                                   |
| `apps/web/src/features/game-catalog/personal-shell.tsx`                               | Initial home identity loading/error boundary                                            |
| `apps/web/src/features/game-catalog/personal-lobby.tsx`                               | New artwork paths, decorative live arrows and correct all-games arrow                   |
| `apps/web/src/ui/midnight.css`, `midnight.tsx`                                        | Home geometry, typography, color/glow, SVG card/podium icons and new background path    |
| `apps/web/src/games/coup/screens/entry.tsx`                                           | Remove retired poster reference and update descriptive alt text                         |
| `apps/web/tests/midnight/lobby.spec.ts`, `visual-revision.spec.ts`                    | Font fallback, loading, identity/error, artwork inventory and reference geometry checks |
| `apps/web/public/assets/home/*.webp`                                                  | Seven new content-hashed illustrations                                                  |
| `apps/web/public/assets/midnight/*.webp`                                              | Seven rejected posters removed                                                          |
| `apps/web/public/assets/fonts/Vazirmatn-4e3fa217d38f.woff2`                           | Pinned self-hosted variable font                                                        |
| `docs/design/licenses/Vazirmatn-OFL.md`                                               | Font license                                                                            |
| `docs/design/midnight-assets.md`, `home-art-prompts.json`, `home-art-provenance.json` | Exact prompt set, generation mode, source paths, asset hashes and typography provenance |
| `docs/adr/063-responsive-home-presentation-and-availability.md`                       | Record replacement visuals/loading strategy and pending review status                   |
| `docs/design/home-visual-revision-review.md`                                          | This report                                                                             |

Review HTML/images live under ignored `test-results/visual-review/` and are not
shipped with the application. No data migration, backfill, dependency/lockfile
change, API/event schema change or deployment-setting change is needed.

Stop here for the owner's visual review. This report does not authorize deployment.

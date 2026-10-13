# Kahroba Phase K3 implementation and acceptance report

Date: 2026-10-13; authorization/work began 2026-10-12. Scope: isolated local UI,
supplied original assets, browser acceptance and K2 Bot failure classification.

## Implementation and components

The isolated module implements `KahrobaSession`, `KahrobaMatch`, `PlayerStrip`,
`NobleRail`, `Marketplace`, `GemBank`, `AffordableCardAssistant`, `ActionBar`,
`PlayerSummary` and `ResultSheet`. Focus-managed sheets implement card details,
explicit colored/gold payment, exact excess-token returns, noble choice,
face-up/blind reservation and owner-private hand. Loading, reconnect, opponent
turn, spectator, invalid projection and finished states are supported.

The table is Persian RTL, with twelve prominent slots, tiers 3/2/1 and four
columns. Costs/scores are trusted view data, English numerals and LTR-isolated.
Noble requirements use permanent card-bonus icons. The assistant uses server
affordability and stable tier/ID ordering with previous/next navigation. Own
handle has no greeting; no generic Match wrapper, redundant heading or remaining-
card panel was added. Spectators get no private hand/action controls. Shared
results retain every winner, rank, prestige and purchased-card tie-breaker.

The existing runtime/Socket/Query/Zustand ports are reused. Public-only schemas
check roles/viewers/pins and deny hidden fields. Commands capture one action ID
and expected version, fence double taps and preserve identity on ambiguous
retry. There is no optimistic authoritative-state mutation. Reconnect clears
private controls pending resync. Engine/dataset imports exist only in Node
fixtures. See [ADR-066](../adr/066-kahroba-isolated-ui-and-browser-acceptance.md)
and [frontend architecture](../architecture/kahroba-ui.md).

## Assets and reference differences

All expected categories were accessible: background, logo, five development
illustrations, four noble portraits, five gems and gold. **17 WebPs / 822,484
bytes**, compared with **35,892,535 original PNG bytes: 97.7% smaller**. Original
ZIP/reference are untouched. Source/output hashes, dimensions, sizes and alpha
were verified for every asset. No official Splendor artwork, unrelated online
imagery, creative artwork replacement or new runtime dependency was introduced.

Four supplied portraits are explicitly reused for ten noble definitions and
decorative seat portraits; they are not ten unique supplied noble assets or
claimed Telegram avatars. Bonus stacks are original inline SVG; deck backs are
CSS. The [design guide](../design/kahroba-ui.md) and
[asset manifest](../design/kahroba-assets.json) record exact mappings/provenance.
Owner-supplied provenance does not establish public publication/trademark rights.

Reference deviations: quieter glow/ornament, existing Vazirmatn, category artwork
reuse, multiple-line narrow costs, vertically scrolling table/sheets and larger
text reflow. A four-player base-game table correctly displays **five nobles**,
while the illustration depicts four. Actual scores/costs follow K1 data rather
than the illustrative examples.

## Actual interactive coverage

Chromium and WebKit both tested:

- **320 × 568, 375 × 667, 390 × 844**, intermediate 360 × 740 and 768 × 1024:
  RTL, safe-area padding, four columns, ASCII costs ≥13 px, ≥44 px market touch
  targets, loaded assets/font, card selection and no horizontal page overflow.
- Two/three/four-player composition, correct opponent/noble counts; assistant
  previous/next and real engine purchases with custom colored/gold allocation at
  **each of the three required mobile sizes**.
- Provisional token selection, exact returns and one atomic complete turn;
  face-up/blind reservation, owner-only hand and spectator denial.
- Explicit multiple-noble choice followed by real acquisition; sole/shared
  results with every winner and authoritative score/rank/tie-breaker.
- Ambiguous post-commit retry: two identical envelopes, one state transition;
  disconnect clears private controls, resync restores the authoritative view.
- Opponent/insufficient/depleted/bad-pin states, keyboard focus/Escape, reduced
  motion, 200% root text, touch and zero axe violations on the tested active table.

The loopback Socket fixture uses the real K1 engine and version/receipt checks.
Rare midgame arrangements are labelled synthetic and restoration-validated;
final snapshots execute real final turns. This is UI evidence, not native
Telegram or a rerun of K2 PostgreSQL/BullMQ integration/recovery evidence.

## Commands and results

Commands were executed through RTK; the table omits that proxy for ordinary use.

| Verification                                                               | Actual result                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @hambazi/web test`                                          | **100 passed / 12 files**, including 13 new Kahroba tests                                                                      |
| `pnpm test`                                                                | **2,016 workspace passed**; **127 infrastructure passed / one existing scanner-environment skip**; 33 of 37 Turbo tasks cached |
| `pnpm typecheck`                                                           | 24 tasks passed, 22 cached                                                                                                     |
| `pnpm lint`, `pnpm format:check`                                           | Passed                                                                                                                         |
| `pnpm check:architecture`                                                  | Passed: 15 workspaces / 273 source files                                                                                       |
| `pnpm --filter @hambazi/web build`                                         | Passed TypeScript, default production bundle and preview-marker boundary                                                       |
| `env -u GIO_MODULE_DIR pnpm --filter @hambazi/web test:kahroba`            | **38 passed**, 19 in each browser, zero skips                                                                                  |
| Focused screenshot recapture, table/full-page versus fixed-dialog/viewport | **26 passed**                                                                                                                  |
| Final static sheet captures with finite animations completed               | **14 passed**                                                                                                                  |
| Existing `test:browser`, pinned local official SDK fixture                 | **30 passed**                                                                                                                  |
| Midnight `table.spec.ts lobby.spec.ts`, Chromium/WebKit                    | **65 passed / 1 fixture teardown failure**; all **30 Coup/Anarchist table cases passed**                                       |
| Affected slow-poll lobby case, three repetitions per browser               | **6 passed**, no existing fixture/application change                                                                           |
| Existing `test:preview`                                                    | **1 passed / 1 legacy English direct-Coup expectation failed**; same case fails on clean pre-Kahroba HEAD                      |
| Production-mode preview launch / preview Vite build                        | Both rejected for expected reasons                                                                                             |
| ZIP/WebP provenance audit                                                  | All 17 hashes/sizes/dimensions/alpha verified; originals unchanged                                                             |
| `git diff --check` / protected baseline comparison                         | Passed; deliberate exceptions listed below                                                                                     |

Final responsive recapture passed **10 cases**, covering all five sizes in both
browsers and explicitly checking the assistant thumbnail width after fixing its
large-screen selector. The retained images include that correction.

The existing Midnight build used its existing simulated staging-origin
configuration; **all requests were intercepted to loopback**. No staging service
was accessed/changed. The ordinary default production build was restored afterward.

The initial Midnight failure was `route.fulfill: Fetch response has been disposed`
at `tests/midnight/fixture.ts:66` during context teardown. Six focused repetitions
passed. This remains a recorded transient fixture failure, not a silently passed
full-suite run. The older direct-Coup test expects `Your cards`, `AMBASSADOR` and
`declare income`; current UI is Persian. Clean HEAD reproduces it. Coup screens
and existing tests were not rewritten.

Earlier K3 iterations caught/fixed an aria-label role issue, 200% tier-label
overflow, a compressed assistant thumbnail and duplicate incompatible-view
alerts; the final 38 tests passed. Initial WebKit navigation failed before UI
execution because Snap's inherited `GIO_MODULE_DIR` loaded incompatible libraries
in `WPENetworkProcess`. Clearing **only that variable for local tests** restored
navigation. No browser sandbox, product security or application configuration
was weakened. No clean broader release gate is claimed.

## K2 Bot failure classification

**Pre-existing, not caused by K2/K3.** Clean pre-Kahroba HEAD
`11c2a53036b6cb4bce14cc040a95e31a208e592c` was exported to
`/tmp/hambazi-k3-baseline-61cbbf10`, installed with its frozen lockfile and built.
Only the disposable launcher was copied; no Kahroba application/runtime source.
Both trees ran fresh isolated PostgreSQL/Redis with the additive flag:

```sh
pnpm test:kahroba:local --bot-regression
```

Each tree: database **17 passed**, sessions **62 passed**, Bot delivery **3 passed /
3 failed**, expected overall exit 1. Default K2 integration inventory is unchanged.

| Same failing test on both trees                               | Location                       |
| ------------------------------------------------------------- | ------------------------------ |
| Immediate support confirmation followed by profile            | `bot-delivery.test.mjs:196:36` |
| Explicit registration, dedupe and Bot restart                 | `bot-delivery.test.mjs:216:31` |
| Ambiguous send/ack recovery without repeating account effects | `bot-delivery.test.mjs:243:31` |

These tests assume creation immediately after the registration keyboard intent.
Existing Auth produces `PROMPT_NAME` / `WAITING` and completes creation after a
valid name reply. Support/user-count expectations consequently fail on both
source baselines. Bot/Auth/Users behavior and test expectations remain unchanged;
the failures are retained, not waived. Repairing this onboarding/test mismatch
requires separate authorization.

## Retained screenshots and evidence

Absolute artifact root: **`/home/mehdi/HamBazi/test-results/kahroba-k3/`** (ignored
local output). `screenshots/` contains 26 actual PNGs. For **each** prefix
`chromium-` and `webkit-`, exact suffixes are:

```text
affordable-320x568.png
affordable-375x667.png
affordable-390x844.png
affordable-360x740.png
affordable-768x1024.png
payment-sheet-320.png
payment-sheet-375.png
payment-sheet-390.png
return-sheet.png
noble-choice.png
sole-victory.png
shared-victory.png
enlarged-text-320.png
```

Tables are full-page captures, fixed sheets are viewport captures. Finite
animations finish for a stable review image. Short screens intentionally scroll
within sheets to reach payment/confirmation; tests use the real controls and
updated projections. The gallery/logs are not native Telegram acceptance.

## Limits and K4 readiness

K3 is complete for **isolated local UI acceptance**. Kahroba remains publicly
disabled. No staging/production deployment, new migration, timer/fallback,
commit, PR or K4 work was performed.

- K2 views provide peer IDs/seats but no usernames. Optional trusted `PublicNames`
  input is implemented; preview handles are labelled synthetic. Without a live
  approved binding, peers truthfully use seat labels. Own handle uses `/v1/me`.
- Native iOS/Android Telegram and staged full-product acceptance still need a
  separately authorized next phase. K2 real-service results are historical here.
- Broader readiness retains the three Bot failures, legacy preview mismatch,
  observed fixture teardown flake and original public-rights/operating holds.
- Existing engine/rules/result pins and untimed policy remain; no backend or
  platform result contract was altered in K3.

Ready for owner visual review and an explicitly authorized K4 scope with these
limits retained. Stop at K3; local completion does not approve activation.

## Exact K3 source files

**Created (40):**

```text
apps/web/dev/kahroba-preview.mjs
apps/web/kahroba.playwright.config.ts
apps/web/kahroba.preview.config.ts
apps/web/public/assets/kahroba/card-art-diamond.webp
apps/web/public/assets/kahroba/card-art-emerald.webp
apps/web/public/assets/kahroba/card-art-onyx.webp
apps/web/public/assets/kahroba/card-art-ruby.webp
apps/web/public/assets/kahroba/card-art-sapphire.webp
apps/web/public/assets/kahroba/gem-diamond.webp
apps/web/public/assets/kahroba/gem-emerald.webp
apps/web/public/assets/kahroba/gem-onyx.webp
apps/web/public/assets/kahroba/gem-ruby.webp
apps/web/public/assets/kahroba/gem-sapphire.webp
apps/web/public/assets/kahroba/kahroba-logo.webp
apps/web/public/assets/kahroba/noble-elder.webp
apps/web/public/assets/kahroba/noble-king.webp
apps/web/public/assets/kahroba/noble-queen-ivory.webp
apps/web/public/assets/kahroba/noble-queen-ruby.webp
apps/web/public/assets/kahroba/palace-background.webp
apps/web/public/assets/kahroba/token-gold.webp
apps/web/src/dev/kahroba-preview.tsx
apps/web/src/games/kahroba/adapters/index.ts
apps/web/src/games/kahroba/assets.ts
apps/web/src/games/kahroba/components/actions.tsx
apps/web/src/games/kahroba/components/sheet.tsx
apps/web/src/games/kahroba/components/table.tsx
apps/web/src/games/kahroba/index.ts
apps/web/src/games/kahroba/screens/match.tsx
apps/web/src/games/kahroba/screens/table.css
apps/web/src/games/kahroba/store/index.ts
apps/web/tests/kahroba/fixtures.d.mts
apps/web/tests/kahroba/fixtures.mjs
apps/web/tests/kahroba/server.mjs
apps/web/tests/kahroba/table.spec.ts
apps/web/tests/unit/kahroba.test.ts
docs/adr/066-kahroba-isolated-ui-and-browser-acceptance.md
docs/architecture/kahroba-ui.md
docs/design/kahroba-assets.json
docs/design/kahroba-ui.md
docs/testing/kahroba-ui.md
```

**Modified (5):**

```text
apps/web/dev/check-preview-boundary.mjs
apps/web/package.json
apps/web/src/platform/runtime.ts
docs/implementation-plan.md
infra/scripts/test-kahroba-local.mjs
```

The harness was already an untracked K2 file. The plan is appended, not rewritten.
All other 65 initial changed/untracked file hashes are unchanged,
including K1/K2 sources, lockfile and the owner's staging containment/current-user
files. Existing Coup/Anarchist, Bot/Auth/Users sources, screens/navigation remain
unchanged. Build outputs, screenshots/gallery/logs and the baseline export are
ignored local artifacts. No commit was created.

# Profile Hub validation — 2026-11-09

Scope: the existing Midnight `/profile` route, lobby avatar projection, additive
Users profile fields, authenticated availability checks and image selection/crop.
See [design](../design/profile-hub.md), [ADR-080](../adr/080-profile-hub.md) and
[asset provenance](../design/profile-avatar-assets.json).

## Passed

- Frozen-lockfile installation, repository lint and architecture boundaries.
- Repository `pnpm typecheck` and API/web production builds.
- Web unit suite: 145 tests; API unit/HTTP suite: 1,098 tests; database unit suite:
  38 tests. Coverage includes input validation, unsafe-avatar rejection, image
  container dimensions before decode, crop bounds, authenticated username checks
  and the profile-only HTTP body limit.
- `pnpm test:auth-http:local` with the installed isolated PostgreSQL 18.6 binaries
  and disposable Redis. Includes migration/restart, atomic save/rollback, existing
  receipt compatibility and concurrent username reservation. The profile suite
  contains 11 tests; no live application database or Telegram credentials were used.
- API `contract:check`, including the unchanged legacy profile baseline and the
  new frozen additive profile baseline.
- Infrastructure suite: 206 passed, 3 optional scanner tests skipped because
  `SECURITY_SCANNER_DIR` was not supplied.
- 42 production-bundle Chromium/WebKit cases across `profile-hub`, `page-layout`,
  `desktop-window` and `touch-scroll`: account/avatar persistence into the lobby,
  unrestricted avatar groups, native/browser navigation guards, 3 MiB validation,
  circular crop and reset, real HEIF decoding, background read failures, same-ID
  retry, accessibility, safe areas, 320/390/768/1280 widths, enlarged text and a
  360px keyboard-sized viewport.
- Eight production browser-policy cases: actual SDK sign-in and Socket.IO under
  CSP, denial of inline scripts/eval, unapproved network/worker sources and framing.
- Formatting of every changed/new text source and `git diff --check`.

## Limits

The repository-wide `pnpm format:check` still reports 208 existing files under
`.superpowers/sdd` and `graphify-out`; these unrelated files were not reformatted.
An initial full Midnight run was stopped after exposing the CSS sizing regression;
the affected suites above were rerun successfully after correction. The entire
146-case Midnight suite was not rerun. Vite reports its main-bundle size
warning plus the 809 kB gzip HEIF decoder chunk, which is loaded only for HEIF.

No server deployment, live database migration, live Telegram WebView acceptance,
device memory stress, capacity/load or soak test was performed. Deploy migration
`202611090001_profile_hub` before the API and web; keep its additive columns during
rollback. The normal staging-origin production web build was restored after the
disposable loopback CSP test build.

## Mobile editing follow-up — 2026-11-10

Scope: profile-only soft-keyboard layout and gesture-based avatar modal. No API,
database, admission policy or runtime deployment changes in this follow-up.

- Web unit suite: 149 passed, including four crop gesture/bounds tests.
- Web typecheck, scoped ESLint/Prettier, production build and diff whitespace checks passed.
- 56 Chromium/WebKit cases passed across `profile-mobile-editing`, `profile-hub`,
  `page-layout`, `desktop-window` and `touch-scroll`. Coverage includes iOS visual
  viewport offsets, Android window/native viewport changes, rotation, focus/scroll
  restoration, reachable save errors, drag/pinch/finger handoff, exact preview/export,
  background scroll locking, native Back/Escape, focus return, existing upload/HEIF
  validation and unchanged lobby behavior. Regression tests reproduced the keyboard,
  slider, stale-scroll, rotation and error-visibility failures before their fixes.
- The modal was visually inspected at mobile size; its final heading-focus styling
  is checked separately in both engines after the final production rebuild.

Browser cases use local fixtures with synthetic Telegram launch/native viewport
events and emulated two-pointer input. Physical Android/iOS Telegram keyboard and
multitouch acceptance remain unverified. No Staging/Production deployment or live
database operation was performed.

These implementation checks were followed by the separately authorized
[Staging deployment and live validation](../operations/profile-mobile-editing-staging-20261110.md).

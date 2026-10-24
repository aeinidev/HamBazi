# Fantasy main lobby — 2026-10-23

The owner approved publication of the progressively reviewed lobby mockup. This
updates the home presentation from ADR-063 and the restored-home layout record;
game admission and runtime availability remain server authoritative.

- The account header sits below Telegram's combined safe/content inset with
  eight pixels of breathing room. Telegram owns its native title/settings bar;
  the Web app does not draw a second native bar.
- The existing wordmark, banner artwork and six game posters stay intact. The
  marketing paragraph and yellow find-game button are replaced with three rows:
  online players, tables in play and today's games. The owner explicitly chose
  `—` until a real aggregate service is connected. No simulated counts, invented
  online indicator, polling endpoint or telemetry collection is introduced.
- The bottom dock has five items in RTL order: games, friends, chat, leaders,
  profile. Games and profile retain their existing navigation. Unimplemented
  friends/chat/leaders and notifications remain disabled with accessible
  coming-soon labels. The dock stays fixed while home scrolls, clears the native
  bottom inset and reserves enough document space to reach the last game card.
- Settings and notification controls use equally sized rounded frames and the
  same sculpted icon family as the dock. Existing profile mutations are retained.
- The unconditional home recovery link is removed. Existing authenticated
  recovery/direct-match routes are preserved. Automatic insertion of an active
  game into the list is a future behavior, not a claim that this presentation
  release implements active-match discovery.

## Artwork

The built-in ImageGen tool generated the transparent 4-column, 2-row atlas from
the reviewed mockup. Cells are games, friends, chat, trophy / profile, bell, gear,
empty. The generated source is retained in the local Codex generated-images
directory. A WebP derivative preserves alpha and uses a content-hashed filename:
`apps/web/public/assets/home/lobby-icons-dfc9dbb84930.webp` (83,218 bytes).
CSS selects atlas cells; labels and all interaction remain live accessible UI.
The existing artwork and fonts are unchanged.

Generation prompt: create a transparent 2:1, 4×2 sprite sheet of seven coherent
sculpted lavender/cyan fantasy icons matching the approved mockup; equal cells,
centered icons, clear padding, consistent upper-left lighting, no text, frames,
backplates or gridlines; top row cards/die, two avatars, speech bubbles, trophy;
bottom row profile medallion, bell, gear, empty. The retained generation request
contains the full prompt and source reference.

## Verification

The existing Web typecheck, unit, build, lint and architecture checks apply.
Browser checks cover the five labels, absent recovery/marketing controls,
truthful placeholder metrics, decoded icon atlas, equal header button geometry,
native header/bottom insets, fixed dock while scrolling, reachability of the last
card, existing availability/recovery routes, RTL and accessibility. Deployment
evidence is recorded separately from local browser fixtures.

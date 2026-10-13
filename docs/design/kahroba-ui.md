# Kahroba K3 interface and supplied assets

K3 follows the supplied palace table's composition with HamBazi's restrained
Midnight navy/glass/cyan/gold treatment. The exact reference PNG and original
archive remain at `/home/mehdi/Downloads`; neither is overwritten or cropped.

## Assets and mapping

The accessible owner archive is `Kahroba_Assets.zip`, SHA-256
`e93bd0672560ef7a99f71f46222f175ddeca5788d0d389f9ec3dcfc85d77d5d8`.
Its README describes independently recreated original illustrations. This is
recorded source provenance, not a verification of publication/trademark rights.
The numeric economy remains the verified K1 dataset; artwork contains no costs,
prestige values or noble requirements.

| Supplied category         | Count | Browser mapping                                                               | Optimized size |
| ------------------------- | ----: | ----------------------------------------------------------------------------- | -------------- |
| Palace background         |     1 | table backdrop                                                                | 576 × 1024     |
| Kahroba logo with alpha   |     1 | centered header                                                               | 320 × 213      |
| Development illustrations |     5 | diamond/sapphire/emerald/ruby/onyx bonus category; same artwork at every tier | 384 × 512      |
| Noble portraits           |     4 | numeric noble suffix modulo four: queen-ivory, king, queen-ruby, elder        | 384 × 512      |
| Gem tokens with alpha     |     5 | same five color keys                                                          | 128 × 128      |
| Gold token with alpha     |     1 | gold key                                                                      | 128 × 128      |

The four supplied portraits are reused for ten noble definitions and decorative
seat portraits. They are not ten unique supplied noble/Telegram-avatar assets.
Requirements and scores remain independent trusted view data. Card-bonus icons
are original inline SVG stacks, intentionally different from spendable tokens.
Tier/reservation backs use CSS, and functional icons are original text/UI shapes.

All 17 WebPs reside in `apps/web/public/assets/kahroba`. PNG image bytes total
**35,892,535**; optimized files total **822,484**, a **97.7% reduction**. Encoding
used Pillow, Lanczos resize, longest side 1024/512/320/128 by category, WebP
quality 88 and method 6. Alpha is preserved. No creative editing or new image
generation was performed. Individual original/optimized dimensions, hashes and
sizes are in [the asset manifest](kahroba-assets.json).

## Table structure

`KahrobaSession → KahrobaMatch` owns the validated session view. Its table is:

1. Brand header and compact navigation/menu.
2. `PlayerStrip`: peers, public tokens/bonuses/prestige and turn marker.
3. `NobleRail`: available nobles and card-bonus requirements.
4. `Marketplace`: tiers 3, 2, 1; four columns each; sensible exhausted slots.
5. `GemBank`: five colors plus gold; selection is provisional.
6. `AffordableCardAssistant`: server affordability, stable tier/ID ordering,
   previous/next controls and fallback after a card leaves the view.
7. `ActionBar`: collect, buy, reserve; authoritative/contextual affordances.
8. `PlayerSummary`: own public handle, resources, prestige and private-hand entry.

Sheets cover card details, colored/gold payments, exact token returns, noble
choice, face-up/blind reservation, owner-only reserved cards, menu and all final
winners/ranks. Dialogs restore focus, trap keyboard focus, support Escape and
prevent background scroll. Spectators get no private hand or action controls.

## Responsive decisions and reference differences

- Four market columns remain visible at 320/375/390 px; important controls scroll
  vertically. Safe-area padding uses existing Telegram viewport variables and
  browser inset fallbacks. There is no sticky bottom bar overlapping content.
- Numeric values use ASCII and explicit LTR isolation. Costs are at least 13 px
  at ordinary 320 px. Root text at 200% reflows resource/cost grids vertically.
- The 4-player game correctly has **five nobles**, while the reference depicts
  four. The UI displays the authoritative player-count-dependent number.
- Costs use multiple lines on narrow cards for readability. Glow/background
  detail is quieter than the illustrative reference. Supplied category artworks
  are reused consistently rather than inventing card-specific illustrations.
- Existing readable Vazirmatn replaces any baked-in illustrative typography.
  Sheets and disabled controls expose real state absent from the static image.
- There is no remaining-deck panel, generic Match wrapper/status heading or
  greeting. Deck counts are used only to disable unavailable blind reservations.

## Identity boundary

Own handle uses the existing authenticated `/v1/me` query. K2's Kahroba projection
contains peer IDs/seats but no usernames. `PublicNames` is an optional trusted
integration input; the local fixture labels synthetic peers. Without that input,
the UI truthfully renders `بازیکن N`. A future approved platform binding must
supply peer public handles before claiming complete live username integration.
No arbitrary user lookup, client-supplied identity authority or auth change is
introduced here.

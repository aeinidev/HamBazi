# HamBazi presentation assets

## Current home revision — local, awaiting visual review

The authoritative reference is the owner's `Luxury Kahroba Gemstones Game Tile.png`.
All six home posters and the four-player banner were recreated with the built-in
`image_gen` tool, one referenced-image editing call per illustration. The phone
frame and screenshot are not shipped. UI titles, identity, buttons, arrows and
availability labels remain live React/CSS/SVG.

[Exact prompts](home-art-prompts.json) and [source PNG paths, production filenames
and SHA-256 values](home-art-provenance.json) record the selected outputs. Source
PNGs remain at their generated-image paths; selected project assets are copied
into `apps/web/public/assets/home/` as content-hashed WebP files. ffmpeg only
resized/encoded the generated outputs to width 1200, quality 88. No old poster
file is retained in the public asset directory. Coup entry and the existing
shell backdrop also reference the replacement Coup artwork.

| Artwork | Composition                                                                         |
| ------- | ----------------------------------------------------------------------------------- |
| Hokm    | Fanned ivory A/K cards with red hearts and dark spades; magenta/purple glow         |
| Kahroba | Green/red/blue/amber gems, illustrated palace card and gold tokens                  |
| Chess   | Golden king, black knight and small pawn; amber/plum lights                         |
| Domino  | Overlapping ivory dominoes with brown pips; teal/cyan table                         |
| Coup    | Red-lit hat-wearing character, queen/king cards and gold coins                      |
| Ludo    | Colorful board, four bright pawns and two white dice                                |
| Banner  | Four smiling stylized young adults playing cards on the right; navy copy space left |

## Typography and existing game assets

Home and the startup loading screen use self-hosted Vazirmatn v33.003, retrieved
from the [official font repository](https://github.com/rastikerdar/vazirmatn/tree/v33.003).
The unmodified variable WOFF2 is
`apps/web/public/assets/fonts/Vazirmatn-4e3fa217d38f.woff2`, SHA-256
`4e3fa217d38fdafc1fea4414ceb58ca5e662cf0ab5fa735a8c8c20e8b42cad92`.
Its [SIL Open Font License](licenses/Vazirmatn-OFL.md) is retained. This is a
legible approximation of the reference typography; the reference provides no
original font file.

`HamBaziDisplay-Regular.ttf` remains the exact owner-supplied font for the existing
Coup UI. The gameplay role assets under `public/assets/coup/` and their provenance
are unchanged; these are distinct from the retired home posters.

## Loading ownership

The former pre-bundle message and automatic sign-in panel were app-controlled.
The replacement shell is immediately in the HTML and persists through SDK,
authentication and the first verified profile fetch. Animation is decorative,
indeterminate and respects reduced motion; it never delays completion.

Telegram's native placeholder is hidden by the existing early `WebApp.ready()`
call once essential UI is available. Native splash icon/colors can be configured
through BotFather, while native controls and OS status/navigation bars are not
React elements. No BotFather configuration is changed here. See the
[official Mini App documentation](https://core.telegram.org/bots/webapps#initializing-mini-apps).

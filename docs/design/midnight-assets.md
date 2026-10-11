# Midnight asset provenance

Tool mode: built-in `image_gen`, reference-image editing, no CLI fallback.
Authoritative references: the owner's `HamBazi-Games-Midnight.png` and
`HamBazi-Coup-Midnight-final.png`. Artwork contains no UI text, plaques, badges or
buttons. React/CSS/SVG renders those separately; reference screenshots are not
shipped as interactive pages.

| Production path under `apps/web/public/assets/midnight/` | Use                      | Encoding                    |
| -------------------------------------------------------- | ------------------------ | --------------------------- |
| `coup-art.webp`                                          | Coup tile and entry hero | 960 × 720, WebP quality 88  |
| `hokm-art.webp`                                          | Disabled Hokm tile       | Width 800, WebP quality 88  |
| `ludo-art.webp`                                          | Disabled Ludo tile       | Width 800, WebP quality 88  |
| `kahroba-art.webp`                                       | Disabled Kahroba card    | Width 1200, WebP quality 82 |
| `chess-art.webp`                                         | Disabled Chess card      | Width 1200, WebP quality 82 |
| `domino-art.webp`                                        | Disabled Domino card     | Width 1200, WebP quality 82 |
| `home-banner.webp`                                       | Home banner illustration | Width 1200, WebP quality 82 |
| `HamBaziDisplay-Regular.ttf`                             | Live display text        | Exact supplied font bytes   |

Generated PNGs remain in
`/home/mehdi/.codex/generated_images/01a12062-96f0-7be0-a3e3-10d8c64fe709/`:
`exec-fc5059e7-446f-402a-b0a1-d1fc4610308c.png` (Coup),
`exec-e764569c-1a32-45c1-906b-7d248ae0da90.png` (Hokm), and
`exec-a56a06a3-0860-4ab6-bc17-614fe39c1e8f.png` (Ludo).
ffmpeg only resized/encoded the selected assets after generation.

The home slice generated four separate text-free illustrations using the built-in
`image_gen` tool. Their source PNGs are in
`/home/mehdi/.codex/generated_images/01a127fe-7a28-7a52-8009-834a8d8e54c7/`:
`exec-044e6d35-2e68-4f52-8f7c-0f82d83fe727.png` (Kahroba),
`exec-1994651b-2269-4da1-b5fe-62a7a0d625a5.png` (Chess),
`exec-029e9a7e-0e1d-46c7-9c69-86675a56d8cc.png` (Domino), and
`exec-9c6feb1d-1411-4614-b505-a29eb0385726.png` (banner). The supplied
`Luxury Kahroba Gemstones Game Tile.png` guided palette and composition; the
phone frame and screenshot are not shipped. ffmpeg only resized/encoded the
generated images. Persian text, disabled badges and buttons are React/CSS.

## Prompt set

The Coup prompt is retained verbatim. Hokm/Ludo below record the generation
briefs; their original full tool-call wording is not retained in this document.

### Coup

```text
Use case: precise-object-edit. Asset type: clean illustration for a real Telegram Mini App, reused in Coup lobby tile and entry hero. Input image: /home/mehdi/Downloads/HamBazi-Coup-Midnight-final.png is the authoritative EDIT TARGET and identity/style reference. Extract and recompose ONLY the artwork of its two large midnight-blue and metallic-gold character cards: the crowned bearded noble on the left and hooded assassin on the right, preserving their faces, costumes, ornate card borders and palette, with the physical golden crown in the foreground on the left and fleur-de-lis coins on the right. Keep the velvet dark royal-blue palace backdrop, warm golden columns and near-black navy shadows. Portrait 4:3-ish composition (near square is acceptable), characters fill the frame, enough foreground for crown/coins, clean continuous velvet/table surface. Remove ALL interface: no HamBazi text, no Persian text, no title plaque, no outer UI frame, no buttons, no book/play/gear/back icons, no lettering, no badge, no watermark. Physical ornamental card artwork is retained. This is illustration only; real text and controls will be built separately in React. Match the attached reference closely, not emerald or cyan. Nontransparent full-bleed background.
```

### Hokm brief

```text
From the supplied Midnight Games reference, produce artwork only for the silver disabled Hokm tile: a fan of silver spade playing cards with king/queen/jack and a deck on dark midnight-blue velvet. Cards/deck occupy the left two-thirds; leave dark continuous velvet on the right for live React title/badge. Keep the ornate palace atmosphere, cool navy/silver palette, full-bleed wide composition. No UI text, labels, badges, locks, buttons, outer interface frame or watermark; physical card artwork is allowed.
```

### Ludo brief

```text
From the supplied Midnight Games reference, produce artwork only for the disabled Ludo tile: a cross-shaped board, blue/silver/burgundy/amber pawns and die on dark midnight-blue velvet. Board/pawns occupy the left two-thirds; leave dark continuous velvet on the right for live React title/badge. Match the cool navy/silver palace atmosphere in a full-bleed wide composition. No UI text, labels, badges, locks, buttons, outer interface frame or watermark.
```

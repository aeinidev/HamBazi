# Fantasy tabletop loading artwork

Generated with the built-in image generation tool, then resized and encoded as WebP for delivery. The original generated PNG is kept by the tool; the application uses the two workspace assets below.

- `apps/web/public/assets/loading/tabletop-640-9475bee80501.webp`: 640 × 960, 96,098 bytes.
- `apps/web/public/assets/loading/tabletop-1024-33456df6ae3f.webp`: 1024 × 1536, 197,234 bytes.

The static HTML and React loader use identical responsive image sources with high fetch priority and decorative empty alt text. The image is masked into the navy background by CSS; the title and status remain real Persian text. Existing minimum duration, readiness gates, reduced motion and opacity-only lobby arrival remain in place.

## Final generation prompt

Use case: stylized-concept. Asset type: premium mobile board-game hub loading-screen illustration, portrait 1024x1536. Create a polished cinematic fantasy game illustration for HamBazi, with NO text or logos. A magical tabletop world suspended in a deep midnight-blue atmosphere: an ornate circular board-game table seen in an inviting three-quarter view, beautifully crafted ivory and gold chess knight and pawn, two chunky ivory dice with correct round dark pips, a fan of elegant playing cards with simple suit symbols, jewel-like colorful ludo tokens and a few teal gemstones. A graceful luminous turquoise magical arc flows around the arrangement, warm amber glow from within the game board, subtle floating spark particles. Premium stylized 3D game key art, refined hand-painted textures, believable materials, bevels and beautiful shadows, strong focal hierarchy, playful yet sophisticated, rich teal/cobalt/gold palette. The game scene should dominate the upper-middle 65 percent; softly fade to clean very dark navy at all edges and across the bottom 25 percent, reserved for separately rendered Persian UI title and loading bar. Keep all important game pieces comfortably inside central 80% width. Avoid a single giant crystal as main subject; actual recognizable board-game objects must be the heroes. No people, no text, no letters, no numbers, no watermarks, no borders, no interface mockup. Opaque dark background, portrait composition.

## Upward extension (2026-10-25)

The built-in image generation tool extended the palace and night sky above the original tabletop. The loading illustration now reaches the top of the viewport and fades only toward the title/status. Static HTML and React share the new sources; the Telegram welcome page retains its original art. The minimum duration and readiness gates are unchanged.

- `apps/web/public/assets/loading/tabletop-extended-640-f0d102a98360.webp`: 640 × 1120, 135,586 bytes.
- `apps/web/public/assets/loading/tabletop-extended-1024-3fab4717a03b.webp`: 1024 × 1792, 255,428 bytes.

### Extension prompt

Use case: precise-object-edit / upward outpainting. Edit target: attached HamBazi fantasy tabletop illustration. Extend the scene UPWARD to show the complete upper palace towers, ornate arches and atmospheric midnight sky with subtle teal magic and warm lanterns. Preserve the recognizable ivory-gold chess knight, pawn, cards, dice, colorful ludo pieces and round board with their existing arrangement and premium 3D illustrated style. Reframe as portrait 1024x1792: additional upper palace/sky occupies top 25%, original tabletop composition occupies middle 55%, bottom 20% softly fades to deep navy for separately rendered UI. The top edge must contain rich continuous palace and sky imagery, not an empty fade or black band; no cut-off towers. Match original perspective, lighting and navy/teal/gold palette. No new characters, no text, no logos, no UI, no watermarks. Opaque background. This is a seamless upward extension of the existing artwork, not a new game scene.

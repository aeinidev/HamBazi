# ADR-077: Public static asset delivery

- Status: Accepted for implementation; staging activation pending release qualification
- Owner: HamBazi engineering
- Date: 2026-10-23
- Supersedes: ADR-038 no-store baseline only for public production `/assets/` responses

## Context

The owner reports late artwork/icons when opening the main and game lobbies.
The deployed static adapter returns `no-store` for public artwork, fonts and
bundles, and sends its 553,489-byte JavaScript bundle without compression.
Kahroba's hero and palace PNGs total 5,524,765 bytes. The ingress strips request
headers, including compression negotiation and cache validators.

## Decision

Keep the generated browser security policy and its default `no-store` unchanged.
The production static adapter overrides only Cache-Control for public images,
fonts, JavaScript and CSS beneath `/assets/` in its validated build inventory.
Vite's eight-character bundle hashes and image/font hexadecimal content hashes
of at least twelve characters receive `public, max-age=31536000, immutable`.
Mutable asset names receive `public, no-cache` and must revalidate. Asset release
names must change with their bytes; HTML always fetches the current release.
Documents, JSON, SDK, errors, health and all authenticated API responses retain
their existing no-store behavior. No runtime/session response is added to the
public inventory, and no service worker or credential storage is introduced.

Derive weak SHA-256 ETags from public file bytes and support If-None-Match/304.
Precompress text at startup using Brotli quality 5 and gzip level 6; choose an
accepted encoding per request and set `Vary: Accept-Encoding`. Keep original
representations for clients without these encodings. Count compressed variants
toward the existing 64 MiB in-memory inventory bound. Compression operates only
on public build bytes, never on authenticated or reflected private content.

The three existing static ingress configurations forward Accept-Encoding and
If-None-Match explicitly while retaining their request-header allowlist. Other
security headers and API/WebSocket routes are preserved.

Deliver derived WebP Kahroba lobby art at up to 960 pixels wide, preserving the
hero's transparency and the approved composition. Main-lobby images use width
srcsets: 600-pixel game tiles and an 800-pixel banner with original 1200-pixel
fallbacks. The banner has high fetch priority; tile decode is asynchronous.
The blurred Coup shell background also uses the compact tile to avoid fetching
the large poster during automatic sign-in before the home screen mounts.
Original artwork is retained. Delivery bytes, hashes and transformations are
recorded in the design manifests.

## Alternatives

- Cache all responses: would retain private responses or stale entry documents.
- Cache mutable filenames indefinitely: would hide updated art on repeat visits.
- Compress on every request: adds avoidable CPU work to a fixed asset inventory.
- Preload every game asset: competes with the current screen on slow connections.

## Consequences

Repeat visits can reuse hashed public assets; mutable art gets lightweight 304s.
New releases require content-based asset names and fresh HTML. Initial transfer
and image decode costs shrink without changing game rules or wire contracts.
Ordinary development/preview retain their existing conservative headers.
Staging activation still uses the existing immutable image, ingress validation,
security binding, rollback and actual HTTPS/browser verification procedures.

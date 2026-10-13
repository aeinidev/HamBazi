# ADR-066: Isolated Kahroba interface and local browser acceptance

- Status: Accepted within the owner's explicit K3 scope; public and staging activation remain held
- Owner: HamBazi product owner
- Date: 2026-10-13
- Related: ADR-064/065, Kahroba rules/module/multiplayer specifications, existing Midnight UI
- Supersedes: none

## Context

K1 and K2 supply pinned rules, safe projections and the platform's authoritative
command lifecycle. Kahroba is still absent from public admission and navigation.
K3 authorizes an interactive Persian interface, supplied original assets and
local Chromium/WebKit acceptance without deploying or activating the game.

## Decision

1. Own the interface in `apps/web/src/games/kahroba`, with a public `index.ts`.
   Mirror only K1's public projection and command schemas in its adapter. Do not
   import the engine, numeric dataset, internal events or state into the browser.
   Check the mirror against actual engine-generated public fixtures in Node tests.
2. Extend `createRuntime` with an optional snapshot projection dependency. Its
   default continues to deny Kahroba. Only the separate local preview supplies
   the Kahroba parser. Do not change application routing, catalogs, admission,
   Telegram authentication, existing game components or server pins.
3. Use server `purchaseOptions` and complete safe `legalCommands` as interaction
   affordances. Custom colored/gold payment and token returns are presentation
   selections; the server validates and resolves the complete turn. Do not
   optimistically alter a match snapshot.
4. Capture `actionId`, `expectedVersion` and the validated command once. Retain
   them on an ambiguous network failure; fence double submissions and resync
   after acknowledgment/conflict. Reset private intent on session/Match changes,
   spectator conversion, finish and unmount. Reconnect rendering clears private
   controls until a validated snapshot is available.
5. Preserve the three-tier/four-column market and scroll vertically. Apply RTL,
   ASCII/LTR numeric isolation, existing Vazirmatn, safe-area/viewport variables,
   focus-managed sheets and reduced motion. Show every authoritative co-winner.
6. Optimize the 17 supplied PNG originals into WebP by resize/encoding only.
   Preserve the archive/reference and record hashes, dimensions, bytes and the
   four-portrait reuse mapping. New bonus symbols are original inline SVG; deck
   backs are CSS. Do not claim new artwork or publication-rights clearance.
7. Run a separate development-only loopback preview on ports 4183/4184. Reject
   production mode/build, bind to `127.0.0.1`, guard host/port/meta in the browser,
   and reject preview markers from production bundles. Synthetic authenticated
   fixtures execute the real Node engine; no production service is contacted.

## Alternatives

- Browser engine/dataset imports risk authority confusion and hidden information
  exposure; public projections are sufficient.
- Public route registration would exceed K3 authorization.
- A static mockup would not verify atomic commands, payments or safe retries.
- K2 provides no opponent handles in its public view. Guessing names or adding
  an unapproved profile lookup is rejected. The component accepts a trusted
  public-name map; until a future integration supplies it, peers use seat labels.

## Consequences

K3 is locally reviewable without opening admission. Exact UI transport schemas
must be updated deliberately alongside a future compatible view revision. The
existing runtime and projections remain the authority boundary; no new runtime
dependency, database migration, timer or platform result change is introduced.

Browser simulation does not establish native Telegram acceptance. K4 still needs
separate authorization and the retained staging/public/release gates. The three
Bot-delivery failures reproduced on the pre-Kahroba commit are documented, not
fixed or waived here. See the K3 acceptance report for actual verification.

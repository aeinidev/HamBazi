# Main lobby game-list scrolling — 2026-10-24

The main lobby keeps its header, banner, game-list heading and bottom navigation
stationary. Only the two-column game list scrolls as the catalog grows. Three rows
share the available list height with a 72px card minimum; extra cards keep that
size instead of shrinking the existing cards or stretching the page. The list
can reduce to one visible row when Telegram safe areas leave less room. Navigation
space includes its larger desktop labels and native bottom insets.

The list is a named, focusable region for keyboard scrolling, including disabled
upcoming games. Its vertical overscroll containment and the existing fitted-page
touch guard prevent movement from chaining into the page at either end. Touch
movement within the list is allowed while there is content in that direction.
Exceptional notices outside the list and accessibility viewport changes retain
the existing natural page-scroll fallback. Other routes and the Kahroba game
are unchanged.

Chromium and WebKit checks cover four viewport sizes, stable geometry before and
after adding eighteen cards, wheel and keyboard access to the last row, touch
cancellation at the edges, document scroll position, and Telegram safe-area insets.
Synthetic touch cancellation checks do not reproduce native iOS rubber-band pixels.

The [deployment record](../operations/main-lobby-game-scroll-deployment-20261024.md)
records validation, publication and the resolved dependency security gate.

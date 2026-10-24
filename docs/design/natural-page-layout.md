# Content-aware page layout — 2026-10-24

The owner requested that short pages use one screen without incidental scrolling,
while allowing extra content to scroll. The Kahroba game table is explicitly
excluded. This replaces the earlier all-pages no-scroll experiment: no content is
paginated, hidden, scaled with transforms or removed to manufacture a fit.

## Route review

| Page / state                                             | Layout and scrolling                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main lobby                                               | Existing fantasy header, banner, six game cards and fixed five-item dock. Artwork consumes flexible remaining height; card rows retain a readable minimum. Additional games scroll inside the game list; exceptional content outside it may extend the document. |
| Settings and profile                                     | Same editable account fields and actions. Reduced redundant spacing; on short displays, appearance and language share a row and display name spans the form. Navigation space remains reserved.                                                                  |
| Auth / registration / session error                      | Existing short forms and notices remain naturally sized. Additional errors and the keyboard can extend the document.                                                                                                                                             |
| Coup entry                                               | Hero image adapts to remaining screen height; tutorial and start actions retain their labels and touch targets.                                                                                                                                                  |
| Coup tutorial                                            | Full continuous text; scrolling is intentional. No page selector or pagination.                                                                                                                                                                                  |
| Coup personal game / details / result                    | Existing game layout, legal-action rendering and private-card dialog retained; existing responsive and action-access tests apply.                                                                                                                                |
| Kahroba home                                             | Header, flexible contained hero, create/search actions, settings/help and connection state share the available height. The inner lobby no longer adds another full viewport to the outer shell padding.                                                          |
| Kahroba create                                           | Flexible decorative gem, original capacity/visibility controls and submit action; no hidden fields.                                                                                                                                                              |
| Kahroba search                                           | Decorative orbit follows available height; search status and cancel remain visible. Extra error/connection notices may extend the document.                                                                                                                      |
| Kahroba private/public waiting rooms                     | Original one-column rosters and all readiness/share/start/cancel controls remain. Reduced spacing; additional members, long names, invitation links and notices can scroll.                                                                                      |
| Kahroba lobby profile/settings/help/notifications/menu   | Existing sheets and focus behavior. Native safe areas bound the sheet; longer help text scrolls inside it.                                                                                                                                                       |
| Kahroba game / spectator / result / action dialogs       | **Unchanged.** No selector in this change applies to a table or its dialogs.                                                                                                                                                                                     |
| Generic full-scope catalog/room/invite/search/statistics | Existing development/full-scope screens retain natural content-driven scrolling. They are not exposed by the deployed owner-auth routes.                                                                                                                         |

## Bounds and accessibility

Page-height budgets use the smaller of the dynamic browser height and Telegram's
stable height. Existing native top/bottom/side insets and launch presentation stay
in place. Short-page rules are scoped to explicit personal screen attributes or
Kahroba lobby descendants. The shared body, root, table and game styles are not
locked or given hidden overflow. Minimum-sized content can always extend the
page, including under text enlargement or an open keyboard.

Browser checks cover 320×568, 390×844, 768×1024 and 1280×720 in Chromium and WebKit,
with native insets, extra rows, long room content and keyboard-sized viewports.
They check document dimensions and actual control bounds, not just visibility.
A separate comparison records the table shell, player strip, nobles, market, bank,
assistant and action bar at three sizes in both engines before and after the
change. The geometry values must be identical.
Production HTTPS checks and deployment identity are recorded separately after
publication. Native Telegram device acceptance remains a separate check.

The [deployment record](../operations/natural-page-layout-deployment-20261024.md)
contains the published release identity and final HTTPS checks.

The subsequent [fitted-page touch boundary](fitted-page-scroll.md) suppresses
elastic dragging while these pages fit, and releases the document when content
needs scrolling. It does not change the page layouts or Kahroba game.

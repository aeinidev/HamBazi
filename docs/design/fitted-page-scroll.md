# Fitted-page touch boundary — 2026-10-24

The owner requested that pages which already fit the screen stay stationary under
vertical touch dragging, so the surrounding black frame is not exposed. Additional
content must remain scrollable. The Kahroba game remains excluded.

`ui/fitted-page-scroll.ts` is an opt-in hook on short personal pages and Kahroba
lobby/search/waiting pages. It measures document and page extents against the
visible viewport before setting a root marker. Only that marker enables root/body
vertical overflow and overscroll suppression. There is no body positioning, fixed
height, layout scaling, permanent touch-action restriction or content removal.

A non-passive vertical touch-move fallback prevents elastic movement on WebKit.
It permits a nested scrollable sheet to consume movement while it has space in
the gesture direction, and stops chaining at its edge. Taps, horizontal gestures,
multitouch zoom, native fields, text selection and pickers remain available.

Resize/mutation/font/image/focus and visual-viewport updates re-evaluate the fit.
Added content outside the main-lobby game list, enlarged text, a smaller viewport
or keyboard, and zoom can release the marker. Additional game cards stay inside
the independently scrollable list and retain the document lock. Shrinking content can restore it. The owning page's cleanup restores the
normal document behavior on route changes and unmount; tutorial and game routes
never opt in. Existing dialog-owned inline body overflow is left untouched.

Browser tests cover canceled vertical gestures, unaffected taps/editing/pinch,
long tutorial scrolling, extra rows, smaller keyboard-sized viewports, nested
help-sheet scrolling and edge containment, modal cleanup and switching to the
unchanged Kahroba table. Production HTTPS checks repeat the fitted-page and
content-growth checks in Chromium and WebKit. Headless engines do not reproduce
native iOS rubber-band pixels; physical Telegram device acceptance remains a
separate check.

The [deployment record](../operations/fitted-page-scroll-deployment-20261024.md)
contains the exact release identity and published HTTPS checks.

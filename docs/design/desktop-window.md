# Desktop window presentation

Telegram launch presentation now requests expansion, fullscreen and swipe control
only on the mobile SDK platforms `ios`, `android` and `android_x`. Other platforms
retain their normal native window. An already-fullscreen non-mobile launch requests
exit once when supported; activation, routes and viewport changes do not repeat it.
Optional bridge errors cannot interrupt authentication.

The native client controls the outer window dimensions; Telegram's WebApp API
provides fullscreen toggles, not arbitrary window resizing. See the
[official WebApp API](https://core.telegram.org/bots/webapps#initializing-mini-apps).

Wide desktop browser viewports use a centered 430px content frame. The pre-JS
loader shares the same width. Navigation and Kahroba sheet backdrops stay inside
the frame without transforms or containment that would move fixed controls.
The welcome page uses a portrait composition within this frame. Mobile SDK
platforms retain their existing layout and native fullscreen presentation.

Verification covers desktop SDK platforms, repeated activation, missing/throwing
native methods, mobile capability versions, loading, responsive frame dimensions,
fixed navigation, catalog scrolling, settings/profile and browser welcome.
Browser tests use the real pinned SDK and synthetic transport, not native clients.

The broader unit suite has three existing failures in `owner-staging.test.tsx`:
static rendering expects immediate lobby content while the existing launch gate
renders the loading screen. These failures also reproduce in the isolated previous
release source snapshot `594d1c95960b8d4434e053c843813019790c6dbb`.

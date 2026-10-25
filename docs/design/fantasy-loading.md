# Fantasy launch loading screen

The shared `HamBaziLoading` screen uses a midnight-blue background, sparse stars,
cyan and gold accents, and an inline SVG emblem of playing cards, a gem and a die.
A rotating ring and floating cards accompany an indeterminate loading track.
All artwork is code-native; no image request or dependency is introduced.

The personal launch shell shows the loader for at least three seconds from its
mount, while authentication and profile requests run concurrently. Slower requests
keep the loader visible until ready; errors retain the normal retry path. The
timer is shared across authentication/profile phases and is cleaned up on unmount.
No artificial percentage is shown.
The personal shell mounts its header only after a session exists. During initial
authentication and profile loading, no brand/settings header is rendered above
the loader. The header returns with the authenticated lobby.
The single Persian status label is announced to assistive technology; decorative
content is hidden from it. Reduced-motion preferences stop every animation while
retaining the status text and a static indeterminate indicator.

The layout accommodates Telegram top/bottom insets and short landscape viewports.
Scoped checks passed: build, TypeScript, ESLint and six Chromium/WebKit browser
cases covering loading transitions, retry, 320×568, 390×844, 844×320, content/footer
separation and reduced motion. Native Telegram acceptance is not claimed.

## Crystal launch revision

The first HTML paint and React loader share the same inline crystal illustration, typography, and layout. Keep the static markup in `apps/web/index.html` aligned with `src/ui/loading.tsx` when editing the artwork. The illustration uses local SVG and CSS without additional image downloads.

After the minimum three seconds and the existing authentication/profile gates, the loader content departs over 360 ms. Only then is the lobby mounted, with a 480 ms entrance. Header and controls remain absent during departure. Reduced motion removes both transitions and the decorative motion. Server errors retain the existing retry screen. The timer is a minimum presentation duration, not a server readiness check.

## Fantasy tabletop revision

The current launch illustration is a cinematic board-game scene featuring chess and ludo pieces, cards and dice. It replaces the crystal emblem in both first-paint HTML and React. Two responsive, content-hashed WebP files keep mobile delivery near 96 KB at the smaller size and 197 KB at the larger size. Text remains live HTML, the image is decorative, and the previous readiness and transition behavior is preserved. See [art provenance and prompt](tabletop-loading-art.md).

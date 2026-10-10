# ADR-060: Midnight lobby in the admitted personal-game scope

- Status: Accepted for restricted staging; native screen acceptance pending
- Owner: HamBazi project owner
- Date: 2026-10-10

## Context

The owner requested the supplied Midnight lobby and Coup entry design, live React
controls, the supplied HamBazi Display font, and reuse of existing personal bot
gameplay. ADR-054/058 admit only the verified owner and one regular numeric-ID test
account. The ordinary multiplayer catalog remains disabled.

## Decision

Use a presentation catalog only inside the existing `owner-auth` runtime scope.
Registered sessions default to `/games`, with enabled Coup and disabled Hokm/Ludo.
Selecting Coup opens its entry; tutorial, settings and native back navigation do
not create matches. Start first reads the current personal match, resumes it if
present, and otherwise sends a stable UUID start intent. Explicit retry retains
that intent and checks the durable current match before retrying creation.

Reuse the existing registered-session gate, profile settings editor, personal
Socket.IO gateway and validated Coup PlayerView/table. The tutorial describes the
current five-role server rules; it defines no rule authority. No public catalog,
room, matchmaking, admission, administrator, registration, engine, Bot, schema or
scan-freshness policy is activated or changed.

Artwork is separate from real text/controls. The supplied TTF is served from the
same origin under existing CSP and bounded static inventory validation, with its
explicit `font/ttf` MIME type. Fallback uses system fonts if loading fails.

## Alternatives

Activating the ordinary catalog would exceed this private staging task. Whole
screenshot hotspots would fail the live text, accessibility and responsive
requirements. Creating a new game or settings backend would duplicate existing
features.

## Consequences

The private lobby can be tested without relaxing admission. Future games are
visibly unavailable and cannot issue requests. Existing full-scope UI remains
available only under its prior deployment gates. Browser fixtures validate the
production UI with synthetic transport; they do not constitute native Telegram
acceptance or prove server rule transitions. Deployment still requires normal
fresh eight-image scans, containment, readiness and route inspection.

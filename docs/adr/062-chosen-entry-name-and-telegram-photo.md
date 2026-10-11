# ADR-062: Chosen entry name and session-scoped Telegram photo

- Status: Accepted; deployment to the existing admitted personal staging authorized on 2026-10-11; production release remains on hold
- Owner: HamBazi project owner
- Date: 2026-10-11
- Supersedes: ADR-057's Telegram-name projection for _new_ registration only

## Context

The entry draft asks new users to choose a game display name in either the Bot or a direct Mini App invite. Existing staging registration is explicit, and existing accounts, matches, v1 routes and admission policy must remain intact. Telegram may include an optional `photo_url` in signed Mini App `user` data. The existing v1 session response is frozen by the contract gate.

## Decision

The Bot's existing Create Account action opens its durable, acknowledged ForceReply name flow. A correlated reply is validated by Users and completes registration through the same Users port used by direct Mini App entry. Registration completion is first-writer-wins; an already completed account keeps its display name and handle. An incomplete technical account may choose its name at completion. Existing completed users are never prompted again. This preserves the explicit registration action and current staging admission gate.

The direct Mini App account endpoint uses the same Users completion operation only after fresh server-side initData verification and current admission. The signed `start_param` remains in client memory through registration and is still resolved separately before room entry. No invite membership is granted by account creation.

Add `/v1/auth/telegram-mini-app/registered-session-photo` with the existing issuance and registration checks. Its optional photo URL is projected only from freshly verified signed `user.photo_url`, restricted to HTTPS `t.me/i/userpic/`, and returned to the Mini App for the current in-memory session. The old session response remains unchanged. The browser image policy allows that one origin; load failure renders a HamBazi fallback avatar. The URL is not stored in Users, durable sessions, JWTs, logs or match state. `GET /v1/me` remains the durable source of the chosen display name, and existing public-name projection supplies player views.

## Alternatives

- Automatically use the Telegram first name: does not let a new player choose the game name.
- Return a photo on the frozen session route: fails the reviewed v1 compatibility gate.
- Persist or proxy the photo: adds storage and image-fetch policy beyond this slice.
- Send direct invite users back to the Bot: drops the active invite journey.

## Consequences

No schema migration or account backfill is required. Existing completed names and matches remain unchanged. An incomplete account's chosen name becomes visible after completion. Photo display requires a fresh valid Mini App launch and an available Telegram URL; failure falls back locally. This slice does not implement the draft's new home screen, future game cards or catalog activation. Staging and production deployment/configuration remain unchanged.

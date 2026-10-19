# Kahroba playable private lobby

The normal authenticated Mini App now follows Home → Kahroba → Create → Share → Join → Ready → host Start → Gameplay → Results. Main Mini App invitations retain server-issued opaque codes and the existing signed Telegram authentication/admission flow. No Named Mini App or manual UUID entry is needed.

## Authority and lifecycle

- Only the existing admitted owner can create a two-seat room. The existing tester can join only with a valid private-room invitation. No users are added.
- When the owner sees a full room, the existing host-authorized `room:start` prepares a durable waiting match and freezes the roster. This is preparation, not gameplay launch.
- Reopening the normal lobby restores the authenticated member’s latest unclosed room through Rooms’ own repository and public port; it never accepts another player’s ID or requires a UUID input.
- Each player independently submits existing versioned/idempotent `match:ready`. Readiness comes from MatchPlayer.readyAt, never local storage or optimistic labels.
- The Kahroba composition opts into explicit host launch; the default orchestration for Coup/Anarchist remains unchanged. All-ready readiness remains durably WAITING_FOR_PLAYERS until host start; READY recovery also holds. An authenticated host can POST the bound room start with actionId and expected match version; the Match transaction rechecks all readiness under its existing lock. STARTING recovery completes activation.
- Room membership protects readiness reads. No card, deck, invite, auth, or hidden game state is included. Existing player-view isolation, v1/v2 results, Worker outbox protection and engine/version pins remain unchanged.
- Duplicate/conflicting actions use existing receipts/version guards. Session changes cancel share acquisition and fence navigation; reconnect retrieves stored room/match state.

## Recovery and rollout

No schema migration is introduced. A fully ready new lobby remains WAITING_FOR_PLAYERS, which both the current and approved historical API hold without starting. Qualify this recovery behavior with the approved historical API/v2 Worker pair; all readyAt values must remain intact. Consumer-before-producer ordering and historical outbox preservation remain mandatory.

All nonessential controls remain disabled without handlers. The additional Ready button uses the existing cyan styling. Reference artwork, RTL, SDK/SRI and gameplay assets are unchanged.

## Staging gate

This source is not deployed. Refresh the actual staging revision, two-account admission, health, exact containment configuration, historical-row preservation, compatible rollback and image identity before requesting final deployment approval. Owner-managed automatic renewal was observed active during the read-only preflight; no timer or service was changed. Production HOLD remains; the fresh-image Trivy exception applies only to restricted staging testing.

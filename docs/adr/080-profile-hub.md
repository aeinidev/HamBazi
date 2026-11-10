# ADR-080 — Profile Hub identity and avatars

- **Status:** Accepted for the requested profile implementation
- **Owner:** HamBazi engineering; product scope requested by repository owner
- **Date:** 2026-11-09
- **Supersedes:** ADR-017 only for the additive editable username/avatar fields

## Context

The owner requested the existing lobby's RTL visual language, ten supplied avatars,
custom uploads, editable unique usernames, statistics and unsaved edit protection.
ADR-015/017 public handles are stable and must remain compatible with older clients.

## Decision

Users owns optional `username` and `profile_avatar` columns. Stable public handles
remain unchanged. A username is 3–32 ASCII letters, digits or underscores, stored
in lowercase with a database unique index. Existing accounts start with no chosen
username; the stable handle is shown until one is saved. Usernames identify the
chosen profile only; authentication and membership continue to use immutable IDs.

`GET /v1/me` adds optional nullable username/avatar. `PATCH /v1/me` accepts optional
username/avatar using the existing atomic revision and seven-day command receipt.
Legacy commands retain their original receipt digest. Authenticated, rate-limited
`GET /v1/me/username-availability?username=...` is advisory; the save transaction
and unique index resolve races with PROFILE_CONFLICT. No other account is returned.

Avatar values are `default`, `hb-01`…`hb-10`, or a JPEG data URL capped at 240,000
characters. Null preserves the session Telegram photo. The client accepts JPEG,
PNG, WebP and HEIF/HEIC up to 3 MiB, decodes and shows a movable/zoomable circular
crop, then renders a 384px JPEG without source metadata. HEIF uses the lazy
`heic-to/csp` decoder (1.6.7, LGPL-3.0; libheif 1.23.7). CSP permits blob workers
for this decoder and data/blob image previews; scripts still prohibit eval/inline
execution, and workers from data URLs or arbitrary remote origins remain denied.
Ten supplied images become self-hosted 512px WebP assets; no new art is generated.
The five/five groups are presentation only and never restrict selection.

The current single avatar is durable application data, not telemetry. Original
uploads and crop source data are discarded; no upload history or separate media
service is introduced. The authenticated profile response is no-store. Existing
statistics remain owned by Leaderboard and use its public HTTP contract.

## Alternatives

- Mutating stable public handles would violate the existing identity contract.
- Browser-only storage would lose edits across sessions and devices.
- A media service/object store is unnecessary for one bounded small avatar per user.

## Consequences

Apply the additive migration before deploying API and web. API's existing table
grants cover the new fields; Worker gains no new access. Keep columns on rollback.
Older binaries can ignore the new columns and wire fields; settings are unchanged.
Large avatar populations may justify object storage later. Final asset rights and
all other open product decisions remain separate from this requested UI change.

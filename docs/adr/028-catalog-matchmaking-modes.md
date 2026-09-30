# ADR-028 — Catalog matchmaking mode discovery

- Status: Accepted by project owner
- Owner: HamBazi project owner / implementation maintainer
- Date: 2026-09-30
- Supersedes: ADR-018's deferral of mode metadata only

## Context

Phase 14A needs a backend-owned mode for matchmaking search. The existing catalog
exposes capacities but no modes. The owner approved an extensible, backward-compatible
catalog addition and resumption of 14A without frontend hard-coding.

## Decision

Add optional `matchmakingModes: Array<{ id: string; title: string }>` to each game.
The registry always projects Coup's `standard` / `Standard` mode. IDs use the same
slug syntax as matchmaking partitions. This is supported metadata, not permission
or an executable descriptor. Keep all effective capabilities, playability and
production admission disabled under ADR-018 and the Phase 7C activation gate.
Future runtime descriptor composition must map this ID to the pinned Coup adapter.

Clients accept additive fields and unknown mode IDs, displaying server titles and
sending the selected ID unchanged. An older server's absent list means no selectable
mode; clients must not invent a fallback. Existing list/detail responses otherwise
remain unchanged. Preserve the original compatibility baseline and freeze the
addition separately. No storage migration or config JSON change is required.

## Alternatives

A UI constant would duplicate registry ownership. A single mode string would make
future choices harder to represent. An enum would unnecessarily close the registry.

## Consequences

Catalog discovery no longer blocks the generic lobby. Mode metadata alone cannot
enable a game, change active Match pins, supply production timers or bypass operator
security. No other open architecture decision is resolved.

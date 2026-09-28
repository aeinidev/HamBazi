# Coup claims engine (Phase 10C)

## Offline version boundary

The public package exports `coupClaimsEngine` with descriptor `coup-claims-v1`,
state schema 3, ruleset `coup-provisional-claims-v1`, and command/event schemas 2.
The completed `coupCoreEngine` and its descriptor remain unchanged. Neither engine
is registered for production admission. ADR-018, Phase 7C, and OD-008 still apply;
these provisional rules and references do not resolve naming, text, or asset rights.
No transport, database, catalog capability, or frontend contract is activated here.

The claims rules snapshot adds explicit `taxCoins`, `stealCoins`, and
`assassinationCost`. Initialization retains 10B's configured starting coins and
seat order. Runtime execution uses the pinned state rules, never replacement
configuration supplied by a caller. Phase 10D owns Exchange, timers, bot policy,
compatibility migrations, frontend adapter, and expanded result metrics.

## Resolution matrix

| Intent        | Action claim | Block eligibility / claim             | Outcome                                                    |
| ------------- | ------------ | ------------------------------------- | ---------------------------------------------------------- |
| Income        | None         | None                                  | Add configured income; end turn                            |
| Foreign aid   | None         | Every other living player / Duke      | Add aid unless block stands                                |
| Tax           | Duke         | None                                  | Add tax if claim stands                                    |
| Steal         | Captain      | Living target / Captain or Ambassador | Transfer up to configured amount, capped by target coins   |
| Assassination | Assassin     | Living target / Contessa              | Pay at declaration; target chooses loss if action succeeds |
| Coup          | None         | None                                  | Pay at declaration; target chooses loss                    |

All declarations require the living current actor; targeted actions require a
different living target. Costs and mandatory Coup threshold are enforced. Card
ownership is deliberately not checked at declaration or block: bluffing is legal.
Exchange and all unknown/extra command fields are rejected in this version.

An action claim opens a challenge window for every other living player, including
non-targets. Only after that window resolves can a block window open. Foreign aid
allows any eligible opponent to block; Steal and Assassination allow only their
target. A block claim opens a fresh challenge window for every other living player,
including the original actor and players who passed in an earlier window. Blocks
cannot themselves be blocked. No second block is offered after a defeated block.

Each eligible player explicitly passes or responds. A pass is irrevocable within
that window. The first valid challenge or block closes its window. This is a
serialized offline engine: the eventual Match writer must order concurrent
commands and enforce action ID / expected state version in Phase 11A. Timer-driven
passes belong to 10D; an offline game can wait indefinitely for input today.

A challenged claimant chooses `PROVE_CLAIM` with an owned matching card index or
`CONCEDE_CLAIM`. Concession remains legal even with a matching card. Proof returns
that card to the deck, shuffles using injected `RandomSource`, and draws its
replacement before the challenger chooses an influence to lose. A false proof is
rejected without changing state. On concession, the claimant chooses a loss.

| Challenge result | Continuation after chosen loss                               |
| ---------------- | ------------------------------------------------------------ |
| Action proved    | Continue action; offer eligible target its block opportunity |
| Action conceded  | Cancel action; refund assassination cost; end turn           |
| Block proved     | Cancel action; retain assassination payment; end turn        |
| Block conceded   | Resolve original action; retain assassination payment        |

Loss selections remove exactly one live card and expose it publicly. A target can
lose twice through a failed assassination challenge or challenged false Contessa
block. If already eliminated by the challenge, no further loss/block choice is
required. Steal resolves its transfer before clearing the eliminated target's
remaining coins, including a target eliminated while defending the Steal. At turn
completion all eliminated players' remaining coins return to the treasury; there
is no separate finite treasury model. The next living seat follows the original
actor, even when that actor was eliminated. One remaining player finishes the game.

Rule references, consulted for ordering and payment semantics:
[rulebook transcription](https://www.rulespal.com/coup/rulebook) and
[Dized rules FAQ](https://rules.dized.com/game/xzsTtI3VTV-2wvos3otxIg/faq).
These references inform the provisional implementation, not legal clearance.

## Replay and information flow

Every accepted command produces one atomic internal `COMMAND_RESOLVED` event.
It records schema version 2, actor, validated command, and `expectedRevision`.
Every event increments revision once; replay rejects duplicates and out-of-order
events. Each response command carries `windowId`; a newly opened window uses the
new revision, while passes retain the current window ID. This also prevents a
late response from affecting a later window with the same eligible player.

Only a proof event includes private replacement card and resulting deck order.
Replay checks card-multiset conservation and applies those stored outcomes without
calling randomness. Events contain no seed or random-generator material. They are
internal durable replay data, never socket events or telemetry. Runtime random
indices must be bounded integers; the production CSPRNG adapter remains later work.

Player/spectator projections use explicit field allowlists. Public data includes
claims, pending action, response eligibility, passes, proof participants, loss
reason, coins, revealed cards, and counts. Only the requesting player's view adds
its own live cards. Deck, replacement outcome, others' hands, and private loss
continuation are absent. Frozen states/events/views prevent accidental mutation.

Tests cover the action/block/challenge matrix, refunds, double losses, eliminated
targets, partial steals, eligibility, stale commands/events, corrupt proof replay,
invalid randomness, view allowlists, and a deterministic 60-game model sweep over
2–6 players. The sweep checks immutability, card conservation, nonnegative coins,
unique elimination, termination, and replay equality after every complete game.

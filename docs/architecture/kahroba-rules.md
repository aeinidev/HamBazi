# Kahroba rules specification — base v1

Status: frozen for the isolated K1 engine under [ADR-064](../adr/064-kahroba-rules-and-isolated-engine.md). This document selects no runtime profile, publication or deployment. New semantic/economic changes require new engine/ruleset pins.

## References and scope

The reference is the standard base game, without expansions, Duel or Marvel mechanics. The [publisher's current English rulebook](https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/10/SCSPL01EN_SPLENDOR_RULES_LIGHT.pdf) provides setup, shortage-only collection, gold substitution and shared-victory clarification. Publisher-maintained Dized rules supply the detailed references below. The [economic verification record](../testing/kahroba-dataset.md) identifies the independently inspected physical base-game dataset and its licensed transcription. No claim is made that the publisher distributes a complete machine-readable table.

## Setup

Support two through four distinct seats. Use 40 tier-one, 30 tier-two and 20 tier-three cards, each granting one permanent gem bonus. Independently shuffle each tier and reveal four slots per tier. Select player count plus one nobles from ten definitions. Start every player without tokens or owned/reserved cards. Colored-token supply per category is four/five/seven for two/three/four players; gold supply is always five. Unselected nobles do not enter play. [Setup and components](https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/10/SCSPL01EN_SPLENDOR_RULES_LIGHT.pdf)

Owner-approved adaptation: choose the starting seat with injected server randomness instead of age. Persist it alongside circular seat order. The client chooses neither the random source nor deck/starter outcomes. Test PRNGs are synthetic; future server composition must supply unbiased CSPRNG integers.

## Primary actions and collection

One completed turn contains one primary action: collection, purchase, reservation, or the approved guarded pass.

Collection chooses either three different non-gold colors or two identical non-gold tokens. The latter requires at least four in that stack before collection. Partial distinct collection is available only when fewer than three colored stacks are nonempty; take one of every remaining color. Zero-token collection is invalid. Gold cannot be collected this way. Holding ten does not prevent collection when the command also supplies a valid excess return. [Token rules](https://rules.dized.com/game/vdDSzuu4RsC8F45PsW0TKw/G1Kh6011QY6oSwFlJEVA8Q/taking-tokens), [current shortage clarification](https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/10/SCSPL01EN_SPLENDOR_RULES_LIGHT.pdf)

At completion, include gold in the ten-token holding limit. Return exactly the excess and never more tokens than the actor holds after collection/reservation. Newly received tokens may be returned, including reservation gold. A zero return is valid when no excess exists. Returning tokens below ten, voluntarily discarding cards, or combining collection with a purchase is invalid. Permanent bonuses are outside the token limit. [Publisher-maintained FAQ](https://rules.dized.com/game/vdDSzuu4RsC8F45PsW0TKw/faq)

## Purchases

Buy one face-up market card or one own reservation. For each gem, payable cost is the printed value minus existing bonuses, floored at zero. Each payment color may cover only its remaining matching cost; gold covers the exact remaining sum. Reject insufficient holdings, overpayment and unrelated payment. Gold may replace a colored token even when that color is held. Spent tokens return to the bank. Free purchases still consume the primary action and grant no excess-discount tokens. [Purchase rules](https://rules.dized.com/game/vdDSzuu4RsC8F45PsW0TKw/kFAA46VCRse8T3hLBTF78Q/buying-a-development-card), [gold clarification](https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/10/SCSPL01EN_SPLENDOR_RULES_LIGHT.pdf)

Purchased cards remain public and owned. Their bonuses apply to subsequent purchases and to the noble check later in this turn; a new card cannot pay its own cost. Replace a removed market card from its own tier's top deck card. When that deck is empty, the slot stays empty. Buying a reservation releases the reserved slot and does not draw a replacement market card. [Bonus and replacement rules](https://rules.dized.com/game/vdDSzuu4RsC8F45PsW0TKw/kFAA46VCRse8T3hLBTF78Q/buying-a-development-card)

## Reservations and visibility

Reserve one face-up market card or the hidden top card of a nonempty chosen tier. Never hold more than three reservations. Acquire one gold if available; an empty gold stack does not prevent reservation. Reserving an affordable card is legal. Reservation consumes the turn's action and cannot also purchase the card. Reserved cards cannot be discarded, traded or acquired by another seat. Refill only a removed face-up slot. [Reservation rules](https://rules.dized.com/game/vdDSzuu4RsC8F45PsW0TKw/rMqINPOWQ2-_c3st8X-3uQ/reserve-a-development-card)

Owner-approved privacy: all reservation identities are owner-only, including formerly face-up cards. Peer/spectator snapshots expose reservation counts, public purchased cards/bonuses, token holdings, prestige, market, nobles and deck sizes. They never expose hidden order, private reservations, unused noble identities or private options. Public memory of previously revealed cards is not erased by this policy.

## Nobles

Only permanent bonuses satisfy requirements. Do not spend those bonuses or pay with tokens/gold. Check at every turn completion, including a pass and the final turn. A single eligible noble is mandatory and may be acquired automatically. If several qualify, the actor must select exactly one; omitted or invalid selection rejects the entire turn. Acquired nobles stay public and are not replaced. Each contributes three prestige. No noble gem bonus is granted. [Noble acquisition](https://rules.dized.com/game/vdDSzuu4RsC8F45PsW0TKw/aVQdOBXYQnS1fCNO2hucCQ/sjCUQaadRam6iRpzKvln1g/visit-from-a-noble), [noble points](https://rules.dized.com/game/vdDSzuu4RsC8F45PsW0TKw/8HWwgyLFQV-4Th75hzhBCg/the-noble-tiles)

## Final round and results

Prestige is purchased-card points plus acquired-noble points. The first completed turn reaching at least fifteen marks the current round for completion. Continue only until everyone has the same turn count; a trigger on the last seat ends immediately. Later players may acquire nobles and outscore the triggerer. [End rules](https://rules.dized.com/game/vdDSzuu4RsC8F45PsW0TKw/F_gzXwUUTuSyGrhYF2f_Cw/end-of-the-game)

Rank by prestige descending, then purchased-card count ascending. Count every purchased card, including zero-point cards; do not count reservations or nobles as purchased development cards. Players still equal at the highest rank share victory. Seat order stabilizes display only. Equal rankings use competition places (1, 1, 3). [Shared-victory clarification](https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/10/SCSPL01EN_SPLENDOR_RULES_LIGHT.pdf)

The Kahroba-owned result preserves all winner IDs. Its legacy structural `winnerId` is populated only for a sole winner. No platform-wide win-credit rule changes here.

## Approved pass and configurable timing

`PASS` is legal only when the actor cannot collect any colored tokens, reserve a market/deck card, or afford a market/own-reserved purchase. A full token hand does not imply blockage because a collection with returns can be legal. An empty gold bank does not disable reservation. Passing performs the normal noble/finish check. No voluntary pass, automatic stalemate result or turn-count termination is selected.

Rules require explicit `turnDurationMs` and `timeoutPolicyVersion`, either both null or both supplied. The validation ceiling is inherited from the existing engine convention, not a selected operating duration. K1 provisions no runtime profile. An enabled deadline is derived from the accepted server timestamp. At exact expiry player execution is rejected. A trusted timeout caller supplies the matching versioned policy; its only input is the same PlayerView as the actor. Null policy output advances nothing. Early/stale/duplicate guards do nothing. Reconnect and takeover do not reset deadlines or transfer private views. Test-only policies/durations are not runtime approvals.

## Atomic resolution and invariants

Validate actor, primary choice, payment/collection, return and noble choice before publishing a result. Resolve on a detached copy and emit one versioned complete-turn event. Failure leaves the input unchanged. Replay reduces that event using persisted pre-state, recorded time and policy origin; it needs no clock or fresh randomness. The initial shuffled snapshot is the replay anchor.

Conserve every development card across deck/market/reservations/purchases and every noble across selected/owned/unused sets. Conserve every token category across bank and hands. Require nonnegative integers, holdings at most ten, reservations at most three, unique seats/identities/ownership, correct tier placement and coherent counters/deadlines/final-round pins. Malformed restoration and unsupported versions fail closed. Match locking, `actionId` idempotency, authentication, outbox delivery and database recovery remain K2 responsibilities.

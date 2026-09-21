# ADR-015 — Account creation and stable human-friendly handles

- **Status:** Accepted
- **Owner:** HamBazi product owner (policy approval), HamBazi engineering (implementation)
- **Date:** 2026-09-15

## Context

Architecture section 6.1 separates internal UUID, Telegram identity, changeable
display name and non-authoritative public handle. The owner explicitly approved
Phase 6B1's display-name, UUID, idempotency and bounded database-collision policy,
replacing the proposed opaque `hb_<hex>` handle with a stable name-derived handle
and numeric suffix. This decision does not authorize onboarding transports.

## Decision

Users owns a shared create-only application port. Its caller must establish the
Telegram identity at an authenticated server boundary; a string/type is not proof
of authentication. No HTTP or Bot route exposes this port in 6B1. Accept canonical
positive decimal Telegram IDs through PostgreSQL signed BIGINT maximum without
JavaScript Number conversion. Never derive internal IDs or handles from these IDs.

Display names are plain text: NFC-normalize, trim and collapse U+0020 spaces, then
require 1–40 Unicode code points and at least one letter, number, punctuation or
symbol. Bound raw input to 256 UTF-16 code units before normalization. Reject
unpaired surrogates, C0/C1 controls, line/paragraph separators and format controls
except ZWNJ/ZWJ. In particular bidi overrides, isolates and directional marks are
rejected. Persian/Arabic, other scripts, combining marks and emoji are supported;
names consisting only of whitespace, marks or joiners are not. Other Unicode
spaces are preserved and count toward the limit. Rendering adapters must escape
plain text; this is not HTML sanitization or a profanity/moderation policy.
Future profile editing must reuse this rule.

For the handle base only, use NFKD, remove combining marks and lowercase. Accept
only ASCII letters/digits, spaces, underscores and hyphens after folding; collapse
separators to underscores and trim them. Require a leading ASCII letter, truncate
to 20 characters and trim a trailing underscore. Otherwise use the deterministic
base `user`. Thus `Mehdi` becomes `mehdi`, `José Silva` becomes `jose_silva`, and
Persian, emoji or mixed-script names use `user` without guessed transliteration.
Append `_` plus an independently CSPRNG-generated integer from 10000 through
99999, e.g. `mehdi_65022`. Generate a separate random UUID server-side. Handles
are public, not secret or authoritative, and never regenerated on display-name
changes. Existing handles, including legacy formats, are preserved.

Validate input before reading or writing, including repeated requests. For a
valid request, an existing ACTIVE identity returns its current stored projection;
a different proposed name never updates it. Existing non-ACTIVE/unknown statuses
fail closed with UNAUTHENTICATED, never reactivating them. First successful create
stores ACTIVE, with optional Telegram username unset and no user-settings row.
Do not return Telegram IDs, timestamps or repository fields in the projection.

Use PostgreSQL uniqueness on Telegram ID, public handle and UUID. After an initial
lookup, each attempt generates UUID/suffix outside the transaction, inserts with
conflicts ignored, then selects the Telegram identity in that same short
READ COMMITTED transaction. Concurrent creation of one identity returns the
winning row, regardless of proposed names/handles. A skipped insert without that
identity is a handle/UUID collision, not authorization to return another user.
Retry with fresh candidates at most five times. Exhaustion, entropy failures and
database failures return sanitized INTERNAL_ERROR; invalid inputs return
INVALID_INPUT. No raw causes/payloads are logged. No network work occurs inside
the transaction. Existing-account reads linearize eligibility at that read;
creation does not issue credentials or replace Auth's later eligibility checks.

Natural Telegram-identity uniqueness is the durable idempotency key for this
create-only operation. Repeats do not freeze future profile edits: they return
the same account with its then-current name and original handle. Future transport
command IDs/deduplication remain 6B2 work. No retention/deletion lifecycle is added.

## Alternatives

- Opaque random hex handles simplify names but were explicitly rejected by the owner.
- Transliteration would add language-specific ambiguity and dependencies; use a
  recognizable folded Latin base when safe and `user` otherwise.
- Unbounded retries can consume resources under collisions; five attempts bound work.
- An upsert that updates a name/status would violate first-create-wins semantics.

## Consequences

Names are recognizable in supported Latin handles, but display-name text becomes
part of a persistent public identifier. Users should not treat handles as private.
Each base has 90,000 suffixes; popular/fallback bases can exhaust or experience
increased collisions. Five attempts can fail before exhaustion. This is not a
launch-capacity claim; any future expansion needs an additive generation-policy
revision that preserves existing handles. The present schema and grants suffice;
no migration, rename endpoint, session change or transport is introduced.

## References

- [Architecture](../ARCHITECTURE.md)
- [Implementation plan](../implementation-plan.md)

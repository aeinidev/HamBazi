# Shared contracts and validation

Phase 5A provides primitives for architecture sections 10.4 and 15, not HTTP
endpoints, Socket.IO listeners, game rules, or persisted Prisma models. See
[ADR-012](../adr/012-shared-contract-foundation.md) for the baseline decisions.

## Ownership and public imports

| Public package        | Owns                                                               | Must not own                                              |
| --------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| `@hambazi/shared`     | Stable public error codes and their TypeScript union               | Domain rules, repositories, miscellaneous utilities       |
| `@hambazi/contracts`  | Version constants, ID aliases, typed envelopes, safe error factory | Prisma models, Zod, transport/framework adapters          |
| `@hambazi/validation` | Reusable Zod schemas, schema factories, sanitized parse result     | Authorization, game legality, session policy, persistence |

Declare workspace dependencies and import only package roots. Feature modules
own concrete command/event/view schemas; generic platform envelopes never depend
on Coup. Client command schemas should reject unknown intent fields. Client-side
receiver payload schemas should strip safe additive server fields. Never pass
`z.unknown()`/`z.any()` as a feature's finished payload validation.

## Wire baseline

- `GameCommandEnvelope<Command>`: schemaVersion **1**, UUID actionId and matchId,
  nonnegative expectedVersion, and command. No actor/userId envelope field.
- `MatchEventEnvelope<Type, Payload>`: schemaVersion **1**, UUID eventId and matchId,
  literal type, positive seq, nonnegative stateVersion, and recipient-safe payload.
- `MatchSnapshotEnvelope<View>`: schemaVersion **1**, UUID matchId, nonnegative
  stateVersion and lastEventSeq, and recipient-safe view. Zero lastEventSeq means
  no events yet; stateVersion and lastEventSeq are independent counters.
- `PageRequest`: explicit positive numeric limit, optional nonempty opaque cursor.
  `createPageRequestSchema(maxLimit)` requires an endpoint-owned maximum.
- `Page<Item>`: validated items and explicit nextCursor (string or null). No total
  count, implicit page size, offset, cursor encoding, or sort order is imposed.
- `ErrorEnvelope`: `{ ok: false, error: { code, message, retryable } }`.

These command/event envelopes are event data, not an outer Socket.IO event-name
wrapper. REST remains under `/v1`; future mutation schemas also require a stable
Idempotency-Key or commandId. No endpoints or event-name registry are selected here.

IDs are semantic string aliases, not nominal authorization tokens. Validation
checks RFC UUID format and preserves casing; valid nil/max sentinel formats are
not proof of a real entity. Invite codes and game registry IDs are not UUID entity
IDs. Telegram identifiers must not pass through Number; their auth/profile wire
representation belongs to their feature phase. Counter range ends at 2,147,483,647
to match current database INTEGER columns; widening requires storage coordination.

## Boundary example

```ts
import { createGameCommandSchema, parseContract } from "@hambazi/validation";
import { commandSchema } from "./owned-command-schema.js";

const schema = createGameCommandSchema(commandSchema);
const result = parseContract(schema, untrustedSocketData);
if (!result.ok) return result;
// Forward result.data plus independently authenticated context to the owning port.
```

`commandSchema` is deliberately owned by the feature, not a generic permissive
fallback. Schema factories validate both JSON payload input and parsed output,
then preserve the feature's inferred type. They do not validate turns, membership,
idempotency, or expectedVersion against the database. JSON here means already
decoded transport data, not a JSON string parser. HTTP query strings need explicit
adapter decoding; the shared schemas do not coerce `"10"` into 10.

Use synchronous, side-effect-free schemas with `parseContract`. It returns typed
data or a static INVALID_INPUT response, including when a custom refinement throws.
Do not log raw Zod errors or input to diagnose failure. This catch is a redaction
boundary, not a substitute for tests of programmer-authored refinements. Enforce
transport byte/depth/rate limits before validation; parsing does not impose them.

## Errors and retry semantics

Rooms adds `ROOM_CONFLICT` for stale or reused commands and `GAME_UNAVAILABLE`
for denied game admission (both HTTP 409, no automatic blind retry). Existing
code meanings remain unchanged. See [ADR-019](../adr/019-private-room-foundation.md).
Phase 8B adds authenticated invite sharing and read-only resolution paths to the
Rooms OpenAPI and v1 baseline without changing prior paths. It reuses RATE_LIMITED,
INVALID_INPUT and NOT_FOUND; no new public error code is needed. Shared transport
helpers encode/decode canonical Telegram room start parameters, while Rooms owns
expiry, admission and authorization. See [ADR-020](../adr/020-room-invitations.md).

`createErrorEnvelope` accepts one of the initial public codes:

| Code                    | Retryable hint | Required caller behavior                                 |
| ----------------------- | -------------- | -------------------------------------------------------- |
| INVALID_INPUT           | false          | Correct the input                                        |
| UNAUTHENTICATED         | false          | Obtain valid authentication                              |
| FORBIDDEN               | false          | Do not retry unchanged authorization                     |
| NOT_FOUND               | false          | Handle unavailable resource                              |
| RATE_LIMITED            | true           | Back off under transport policy                          |
| GAME_STATE_CONFLICT     | true           | Resync before deciding whether to retry                  |
| CLIENT_UPGRADE_REQUIRED | false          | Upgrade via future negotiation policy                    |
| INTERNAL_ERROR          | false          | Show generic failure; no unsafe automatic mutation retry |

Messages are static safe defaults, not a localization or branching API. The
factory cannot attach arbitrary messages, causes, database metadata, or rejected
values. Received error codes are syntactically checked uppercase identifiers,
not a closed enum: unfamiliar codes use a generic client fallback. Never render
received messages as HTML or log error objects wholesale. Infrastructure code
mapping and HTTP statuses are owned by future use cases/adapters.

## Compatibility and verification

Command envelopes reject unknown fields. Roll out servers that accept a new
optional command field before clients send it; keep old-client commands valid.
Receiver schemas strip additive event/snapshot/page/error fields, while still
requiring known mandatory fields and supported versions. Feature payload schemas
must follow the same receiver convention where additive compatibility is needed.
Unsupported versions return parse failure; minimum-client-version negotiation
and CLIENT_UPGRADE_REQUIRED mapping remain adapter work.

Changes to required fields, types, accepted ranges, event meaning, or names require
explicit compatibility review. Breaking changes need a new schema/version path
and ADR, not an in-place v1 edit. Add new error codes without changing old meanings.
Preserve previous supported fixtures when introducing a new version. Generated
OpenAPI/event catalogs and CI breaking-diff automation arrive with real transports
and CI, not empty endpoint schemas in this phase.

Phase 12A now generates the Socket.IO v1 event catalog and checks it against a
frozen baseline. See [the realtime gateway contract](realtime-gateway.md).

Tests in `packages/validation/tests` cover the three packages together: positive
and negative schemas, typed envelope alignment, JSON round trips, unknown-field
handling, unsupported versions, safe counters, stable errors, and redaction.
Production compilation checks shared/contracts without Node or DOM globals;
validation includes DOM declarations only because Zod declares the cross-runtime
URL type. Test compilation separately opts into Node types. Library checks keep
skipLibCheck disabled.

Run the declared checks through Turbo so dependency declarations are built first:

```sh
pnpm exec turbo run test --filter=@hambazi/validation
pnpm check
```

Passing these tests does not prove persistence, replay, player-view secrecy,
deduplication, gap recovery, or connection handling. Each remains an explicit
feature-phase acceptance gate. No internal Match state may be serialized merely
because it fits the generic JSON envelope.

Phase 15A adds the owner-approved `chat:send`/`chat:list` intents, `chat:message`
payload, independent Chat sequence and `CHAT_CONFLICT` without changing old error
meanings or existing baselines. The new Chat v1 baseline is checked by the same
realtime generator. See [Match chat](match-chat.md) for Unicode normalization,
server-side limits, retry identity and content-free delivery jobs.

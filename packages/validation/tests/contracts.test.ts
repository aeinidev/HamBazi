import {
  createErrorEnvelope,
  MAX_WIRE_COUNTER,
  WIRE_SCHEMA_VERSION,
  type ErrorEnvelope,
  type GameCommandEnvelope,
  type MatchEventEnvelope,
  type MatchSnapshotEnvelope,
  type Page,
  type PageRequest,
} from "@hambazi/contracts";
import { ERROR_CODES, type ErrorCode } from "@hambazi/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  createGameCommandSchema,
  createMatchEventSchema,
  createMatchSnapshotSchema,
  createPageRequestSchema,
  createPageSchema,
  entityIdSchema,
  errorEnvelopeSchema,
  eventSequenceSchema,
  knownErrorCodeSchema,
  lastEventSequenceSchema,
  parseContract,
  stateVersionSchema,
  wireSchemaVersionSchema,
} from "../src/index.js";

// Synthetic protocol fixtures, not Coup rules or production Game Module payloads.
const id = "a9659a20-93bb-4b86-a7bc-fc64600da8f6";
const actionId = "bb55f7c2-3337-4c55-81d1-3ca671aa3a2c";
const eventId = "e72d93cd-0df9-49fd-a49a-3fd38a393146";
const commandSchema = z.strictObject({ type: z.literal("TEST_INTENT"), targetId: entityIdSchema });
const payloadSchema = z.object({ count: z.number().int().min(0) });
const commandEnvelopeSchema = createGameCommandSchema(commandSchema);
const eventEnvelopeSchema = createMatchEventSchema("test.changed.v1", payloadSchema);
const snapshotSchema = createMatchSnapshotSchema(payloadSchema);
const command = {
  schemaVersion: 1,
  actionId,
  matchId: id,
  expectedVersion: 0,
  command: { type: "TEST_INTENT", targetId: id },
} as const;
const event = {
  schemaVersion: 1,
  eventId,
  matchId: id,
  type: "test.changed.v1",
  seq: 1,
  stateVersion: 1,
  payload: { count: 2 },
} as const;
const snapshot = {
  schemaVersion: 1,
  matchId: id,
  stateVersion: 0,
  lastEventSeq: 0,
  view: { count: 0 },
} as const;

describe("wire primitives", () => {
  it.each([
    id,
    id.toUpperCase(),
    "01955d66-fd92-7c3e-9b10-09fe9a754123",
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
  ])("accepts an RFC UUID without choosing a generation version: %s", (value) => {
    expect(entityIdSchema.parse(value)).toBe(value);
  });

  it.each([
    "",
    "room_opaque",
    "123",
    123,
    null,
    undefined,
    ` ${id}`,
    id.replaceAll("-", ""),
    "a9659a20-93bb-9b86-a7bc-fc64600da8f6",
    "a9659a20-93bb-4b86-77bc-fc64600da8f6",
  ])("rejects a malformed identity: %s", (value) =>
    expect(entityIdSchema.safeParse(value).success).toBe(false),
  );

  it("pins schema version independently from match counters", () => {
    expect(WIRE_SCHEMA_VERSION).toBe(1);
    expect(wireSchemaVersionSchema.parse(1)).toBe(1);
    for (const value of [0, 2, "1", null, undefined]) {
      expect(wireSchemaVersionSchema.safeParse(value).success).toBe(false);
    }
  });

  it("permits zero counters but starts delivered event sequences at one", () => {
    expect(stateVersionSchema.parse(0)).toBe(0);
    expect(lastEventSequenceSchema.parse(0)).toBe(0);
    expect(eventSequenceSchema.safeParse(0).success).toBe(false);
    expect(eventSequenceSchema.parse(1)).toBe(1);
    expect(stateVersionSchema.parse(MAX_WIRE_COUNTER)).toBe(2_147_483_647);
  });

  it.each([-1, 0.5, MAX_WIRE_COUNTER + 1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "1", null])(
    "rejects an unsafe counter without coercion: %s",
    (value) => {
      for (const schema of [stateVersionSchema, eventSequenceSchema, lastEventSequenceSchema]) {
        expect(schema.safeParse(value).success).toBe(false);
      }
    },
  );
});

describe("commands", () => {
  it("round trips an intent envelope without modifying it", () => {
    const serialized = JSON.stringify(command);
    expect(commandEnvelopeSchema.parse(JSON.parse(serialized))).toEqual(command);
    expect(JSON.stringify(command)).toBe(serialized);
    expectTypeOf<z.output<typeof commandEnvelopeSchema>>().toExtend<
      GameCommandEnvelope<z.output<typeof commandSchema>>
    >();
  });

  it.each(["schemaVersion", "actionId", "matchId", "expectedVersion", "command"])(
    "requires %s",
    (key) => {
      const missing: Record<string, unknown> = { ...command };
      delete missing[key];
      expect(parseContract(commandEnvelopeSchema, missing).ok).toBe(false);
    },
  );

  it.each([
    { userId: id },
    { actorId: id },
    { state: { hidden: "synthetic-sensitive-value" } },
    { expectedVersion: "0" },
    { expectedVersion: -1 },
    { schemaVersion: 2 },
    { actionId: "not-uuid" },
    { command: null },
    { command: { type: "OTHER" } },
    { command: { type: "TEST_INTENT", targetId: id, userId: id } },
  ])("rejects invalid intent or envelope fields %#", (changes) => {
    expect(parseContract(commandEnvelopeSchema, { ...command, ...changes })).toEqual(
      createErrorEnvelope("INVALID_INPUT"),
    );
  });

  it("preserves the client action ID and version on repeated parsing", () => {
    const first = parseContract(commandEnvelopeSchema, command);
    expect(parseContract(commandEnvelopeSchema, command)).toEqual(first);
    expect(first).toEqual({ ok: true, data: command });
    // Parsing is not durable idempotency; Match processing implements that later.
  });

  it.each([1n, undefined, NaN, Infinity, new Date(0), new Map(), () => 1])(
    "rejects non-JSON input even when a feature supplies a permissive schema %#",
    (value) => {
      const schema = createGameCommandSchema(z.unknown());
      expect(parseContract(schema, { ...command, command: { value } }).ok).toBe(false);
    },
  );

  it("rejects a feature transform producing a non-JSON output", () => {
    const schema = createGameCommandSchema(z.string().transform(() => new Date(0)));
    expect(parseContract(schema, { ...command, command: "synthetic" }).ok).toBe(false);
  });
});

describe("recipient event and snapshot receiver schemas", () => {
  it("round trips public events and checks their TypeScript contract", () => {
    expect(eventEnvelopeSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
    expectTypeOf<z.output<typeof eventEnvelopeSchema>>().toExtend<
      MatchEventEnvelope<"test.changed.v1", z.output<typeof payloadSchema>>
    >();
  });

  it("strips additive envelope and feature fields without passing them downstream", () => {
    expect(
      eventEnvelopeSchema.parse({ ...event, additive: true, payload: { count: 2, newField: 3 } }),
    ).toEqual(event);
    expect(
      snapshotSchema.parse({ ...snapshot, additive: true, view: { count: 0, newField: 3 } }),
    ).toEqual(snapshot);
  });

  it.each([
    { schemaVersion: 2 },
    { type: "test.other.v1" },
    { eventId: "" },
    { matchId: null },
    { seq: 0 },
    { seq: 1.2 },
    { stateVersion: -1 },
    { payload: {} },
  ])("rejects incompatible or incomplete events %#", (changes) => {
    expect(parseContract(eventEnvelopeSchema, { ...event, ...changes }).ok).toBe(false);
  });

  it("accepts empty-history snapshots and independent version/sequence counters", () => {
    expect(snapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(
      snapshotSchema.parse({ ...snapshot, stateVersion: 3, lastEventSeq: 7 }).lastEventSeq,
    ).toBe(7);
    expectTypeOf<z.output<typeof snapshotSchema>>().toExtend<
      MatchSnapshotEnvelope<z.output<typeof payloadSchema>>
    >();
  });

  it.each([
    { stateVersion: undefined },
    { lastEventSeq: undefined },
    { lastEventSeq: -1 },
    { schemaVersion: 2 },
    { view: null },
  ])("rejects invalid reconnect metadata %#", (changes) => {
    expect(parseContract(snapshotSchema, { ...snapshot, ...changes }).ok).toBe(false);
  });
});

describe("pagination", () => {
  const requestSchema = createPageRequestSchema(20);
  const pageSchema = createPageSchema(payloadSchema);

  it("accepts an explicit bounded limit and opaque cursor without choosing its encoding", () => {
    expect(requestSchema.parse({ limit: 1 })).toEqual({ limit: 1 });
    expect(requestSchema.parse({ limit: 20, cursor: "opaque+/=cursor" })).toEqual({
      limit: 20,
      cursor: "opaque+/=cursor",
    });
    expectTypeOf<z.output<typeof requestSchema>>().toExtend<PageRequest>();
  });

  it.each([
    {},
    { limit: 0 },
    { limit: 21 },
    { limit: 1.5 },
    { limit: "2" },
    { limit: 1, cursor: "" },
    { limit: 1, cursor: null },
    { limit: 1, offset: 0 },
  ])("rejects an invalid normalized page request %#", (value) => {
    expect(parseContract(requestSchema, value).ok).toBe(false);
  });

  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "requires an explicit valid endpoint maximum: %s",
    (value) =>
      expect(() => createPageRequestSchema(value)).toThrow(
        "Pagination maximum must be a positive safe integer",
      ),
  );

  it("round trips pages and represents end of pagination with null", () => {
    for (const page of [
      { items: [], nextCursor: null },
      { items: [{ count: 1 }], nextCursor: "next" },
    ]) {
      expect(pageSchema.parse(JSON.parse(JSON.stringify(page)))).toEqual(page);
    }
    expectTypeOf<z.output<typeof pageSchema>>().toExtend<Page<z.output<typeof payloadSchema>>>();
  });

  it.each([
    { items: [] },
    { items: [], nextCursor: "" },
    { items: [{}], nextCursor: null },
    { items: null, nextCursor: null },
  ])("requires validated items and explicit continuation state %#", (value) => {
    expect(parseContract(pageSchema, value).ok).toBe(false);
  });
});

describe("stable, sanitized errors", () => {
  it("pins the initial public code catalog", () => {
    expect(ERROR_CODES).toEqual([
      "INVALID_INPUT",
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "NOT_FOUND",
      "RATE_LIMITED",
      "GAME_STATE_CONFLICT",
      "PROFILE_CONFLICT",
      "ROOM_CONFLICT",
      "GAME_UNAVAILABLE",
      "CLIENT_UPGRADE_REQUIRED",
      "INTERNAL_ERROR",
    ]);
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
    expectTypeOf<z.output<typeof knownErrorCodeSchema>>().toEqualTypeOf<ErrorCode>();
  });

  it.each(ERROR_CODES)("constructs a complete JSON-safe public error: %s", (code) => {
    const error = createErrorEnvelope(code);
    expect(knownErrorCodeSchema.parse(code)).toBe(code);
    expect(error.error.code).toBe(code);
    expect(typeof error.error.message).toBe("string");
    expect(typeof error.error.retryable).toBe("boolean");
    expect(errorEnvelopeSchema.parse(JSON.parse(JSON.stringify(error)))).toEqual(error);
  });

  it("matches the architecture conflict example", () => {
    expect(createErrorEnvelope("GAME_STATE_CONFLICT")).toEqual({
      ok: false,
      error: { code: "GAME_STATE_CONFLICT", message: "Client state is stale", retryable: true },
    });
    expectTypeOf<z.output<typeof errorEnvelopeSchema>>().toExtend<ErrorEnvelope>();
  });

  it.each(["__proto__", "constructor", "synthetic-secret-not-a-code"])(
    "rejects unsupported server codes even if JavaScript bypasses the type check: %s",
    (code) => {
      expect(() => createErrorEnvelope(code as ErrorCode)).toThrow("Unknown public error code");
    },
  );

  it("receives unfamiliar future codes without widening the server's current catalog", () => {
    const future = {
      ok: false,
      error: { code: "FUTURE_ERROR", message: "Future", retryable: false },
    };
    expect(errorEnvelopeSchema.parse({ ...future, additive: 1 })).toEqual(future);
    expect(knownErrorCodeSchema.safeParse("FUTURE_ERROR").success).toBe(false);
  });

  it.each([
    { code: "" },
    { code: "lowercase" },
    { code: "INVALID INPUT" },
    { message: 1 },
    { retryable: "true" },
    { retryable: undefined },
  ])("rejects malformed error fields %#", (changes) => {
    const error = createErrorEnvelope("INVALID_INPUT");
    expect(
      parseContract(errorEnvelopeSchema, { ...error, error: { ...error.error, ...changes } }).ok,
    ).toBe(false);
  });

  it("does not retain raw rejected values, custom messages, unknown keys, or thrown causes", () => {
    const sensitive = "synthetic-secret-do-not-expose";
    const schemas = [
      z.strictObject({ count: z.number() }),
      z.string().refine(() => false, { message: sensitive }),
      z.string().transform(() => {
        throw new Error(sensitive);
      }),
    ];
    for (const schema of schemas) {
      for (const input of [sensitive, { [sensitive]: sensitive }]) {
        const result = parseContract(schema, input);
        expect(result).toEqual(createErrorEnvelope("INVALID_INPUT"));
        expect(JSON.stringify(result)).not.toContain(sensitive);
        expect(Object.keys(result)).toEqual(["ok", "error"]);
      }
    }
  });

  it("returns independent error objects so callers cannot mutate later responses", () => {
    const error = errorEnvelopeSchema.parse(createErrorEnvelope("INVALID_INPUT"));
    error.error.message = "caller mutation";
    expect(createErrorEnvelope("INVALID_INPUT").error.message).toBe("Invalid input");
  });
});

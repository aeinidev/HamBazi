import { z } from "zod";
import { createRoomSchema } from "../application/rooms.js";
export const roomAckSchema = z.strictObject({
  ok: z.literal(true),
  schemaVersion: z.literal(1),
  commandId: z.uuid(),
  roomId: z.uuid(),
  appliedVersion: z.number().int().nonnegative(),
});
export const roomResponseSchema = z.strictObject({
  ok: z.literal(true),
  schemaVersion: z.literal(1),
  room: z.strictObject({
    id: z.uuid(),
    gameId: z.string(),
    hostUserId: z.uuid(),
    capacity: z.number().int().positive(),
    version: z.number().int().nonnegative(),
    status: z.enum(["WAITING", "FULL", "STARTING", "STARTED", "CLOSED", "EXPIRED"]),
    expiresAt: z.number().int().nonnegative(),
    startedMatchId: z.uuid().nullable(),
    members: z.array(
      z.strictObject({
        userId: z.uuid(),
        seat: z.number().int().nonnegative(),
        joinedAt: z.number().int().nonnegative(),
        joinedVersion: z.number().int().nonnegative(),
      }),
    ),
  }),
});
export function roomsOpenApiDocument() {
  const json = (schema: z.ZodType) =>
    z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  const content = (schema: z.ZodType) => ({ "application/json": { schema: json(schema) } });
  const error = z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      code: z.enum([
        "INVALID_INPUT",
        "UNAUTHENTICATED",
        "FORBIDDEN",
        "NOT_FOUND",
        "RATE_LIMITED",
        "ROOM_CONFLICT",
        "GAME_UNAVAILABLE",
        "INTERNAL_ERROR",
      ]),
      message: z.string(),
      retryable: z.boolean(),
    }),
  });
  const operation = (operationId: string, schema: z.ZodType, success: number) => ({
    operationId,
    security: [{ bearer: [] }],
    description:
      "Opt-in room transport. Server-authenticated ACTIVE user; create requires eligible Games admission, reads require membership. Per-user Redis budgets fail closed on outage. No-store. Times are Unix milliseconds. Create retries use the same commandId and input and return the original minimal acknowledgement; GET reads current state. No invite code is exposed. Join/leave/start are application ports for future Socket adapters, not REST routes.",
    responses: {
      [success]: { description: "Success", content: content(schema) },
      ...Object.fromEntries(
        [400, 401, 403, 404, 409, 413, 415, 429, 500, 503].map((status) => [
          status,
          { description: "Sanitized failure; 429 includes Retry-After", content: content(error) },
        ]),
      ),
    },
  });
  return {
    openapi: "3.1.0",
    info: { title: "HamBazi Private Rooms", version: "1.0.0" },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    },
    paths: {
      "/v1/rooms": {
        post: {
          ...operation("createRoom", roomAckSchema, 201),
          requestBody: { required: true, content: content(createRoomSchema) },
        },
      },
      "/v1/rooms/{id}": {
        get: {
          ...operation("readRoom", roomResponseSchema, 200),
          parameters: [{ name: "id", in: "path", required: true, schema: json(z.uuid()) }],
        },
      },
    },
  };
}

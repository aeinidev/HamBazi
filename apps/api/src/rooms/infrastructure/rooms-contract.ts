import { z } from "zod";
import { createRoomSchema, resolveInviteSchema } from "../application/rooms.js";
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
export const inviteResponseSchema = z.strictObject({
  ok: z.literal(true),
  schemaVersion: z.literal(1),
  invite: z.strictObject({
    roomId: z.uuid(),
    expiresAt: z.number().int().nonnegative(),
    startParam: z.string().regex(/^room_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048](?![\s\S])/),
    deepLink: z
      .string()
      .regex(
        /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}\/[A-Za-z0-9_]{1,64}\?startapp=room_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048](?![\s\S])/,
      ),
  }),
});
export const invitePreviewSchema = z.strictObject({
  ok: z.literal(true),
  schemaVersion: z.literal(1),
  room: z.strictObject({
    id: z.uuid(),
    gameId: z.string(),
    capacity: z.number().int().positive(),
    status: z.enum(["WAITING", "FULL"]),
    version: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
  }),
});
/** Private Main Mini App response; the public named-app v1 contract is unchanged. */
export const mainInviteResponseSchema = inviteResponseSchema.extend({
  schemaVersion: z.literal(2),
  invite: inviteResponseSchema.shape.invite.extend({
    deepLink: z
      .string()
      .regex(
        /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}\?startapp=room_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048](?![\s\S])/,
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
      "/v1/rooms/{id}/invite": {
        get: {
          ...operation("shareRoomInvite", inviteResponseSchema, 200),
          description:
            "ACTIVE authenticated host only; waiting/full room. Stable bearer invitation and deadline; no-store. Uses shared per-user invite budget, fails closed on Redis outage.",
          parameters: [{ name: "id", in: "path", required: true, schema: json(z.uuid()) }],
        },
      },
      "/v1/room-invites/resolve": {
        post: {
          ...operation("resolveRoomInvite", invitePreviewSchema, 200),
          description:
            "Authenticated read-only limited preview, no roster or membership effect. Malformed input is INVALID_INPUT; unknown, expired or no longer waiting/full invitations are NOT_FOUND. Shares invite budget with sharing and application join. No-store. Client retains startParam in memory through onboarding and sends parsed inviteCode with the later Socket join command; identity always comes from the authenticated session.",
          requestBody: { required: true, content: content(resolveInviteSchema) },
        },
      },
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

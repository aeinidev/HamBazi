import { z } from "zod";
import {
  settingsSchema,
  profilePatchSchema,
  usernameSchema,
  avatarSchema,
} from "../application/profile.js";
export const usernameAvailabilitySchema = z.strictObject({
  schemaVersion: z.literal(1),
  available: z.boolean(),
});
export const profileResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  userId: z.uuid(),
  displayName: z.string().min(1),
  publicHandle: z.string().min(1),
  username: usernameSchema.nullable().optional(),
  avatar: avatarSchema.nullable().optional(),
  version: z.number().int().min(0).max(2147483647),
  settings: settingsSchema,
});
export const profileAckSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: z.uuid(),
  appliedVersion: z.number().int().min(1).max(2147483647),
});
export function profileOpenApiDocument() {
  const json = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "draft-2020-12" });
  const error = z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      code: z.enum([
        "INVALID_INPUT",
        "UNAUTHENTICATED",
        "FORBIDDEN",
        "NOT_FOUND",
        "PROFILE_CONFLICT",
        "RATE_LIMITED",
        "INTERNAL_ERROR",
      ]),
      message: z.string(),
      retryable: z.boolean(),
    }),
  });
  const content = (schema: z.ZodType) => ({ "application/json": { schema: json(schema) } });
  const responses = (schema: z.ZodType) => ({
    "200": { description: "Success; no-store", content: content(schema) },
    ...Object.fromEntries(
      [400, 401, 403, 404, 409, 413, 415, 429, 500, 503].map((status) => [
        status,
        { description: "Sanitized failure; 429 includes Retry-After", content: content(error) },
      ]),
    ),
  });
  return {
    openapi: "3.1.0",
    info: { title: "HamBazi Profile", version: "1.0.0" },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    },
    paths: {
      "/v1/me/username-availability": {
        get: {
          operationId: "checkUsernameAvailability",
          security: [{ bearer: [] }],
          parameters: [
            { name: "username", in: "query", required: true, schema: json(usernameSchema) },
          ],
          responses: responses(usernameAvailabilitySchema),
          description:
            "Authenticated advisory check; case-insensitive. Uniqueness is rechecked atomically on save. Uses the profile read quota.",
        },
      },
      "/v1/me": {
        get: {
          operationId: "readProfile",
          security: [{ bearer: [] }],
          responses: responses(profileResponseSchema),
          description:
            "Current ACTIVE user only. Missing settings use defaults without writes. Rate exhaustion returns 429; Redis failure fails open with telemetry, never bypassing authentication or database checks.",
        },
        patch: {
          operationId: "patchProfile",
          security: [{ bearer: [] }],
          requestBody: { required: true, content: content(profilePatchSchema) },
          responses: responses(profileAckSchema),
          description:
            "Nonempty patch; settings if present must be nonempty. ADR-015 name validation. Partial settings merge. Optional username (3-32 ASCII letters/digits/underscore, normalized lowercase) and avatar (official ID, default, or bounded JPEG data URL). Same-value edits increment shared revision. Seven-day normalized-command retry acknowledgements; mismatched command reuse/stale revision or occupied username returns PROFILE_CONFLICT. After receipt expiry old applied requests remain stale, but original acknowledgement is unavailable. GET current profile after success. Redis failure fails closed. Identity and stable public handles are not editable. See ADR-080.",
        },
      },
    },
  };
}

import { z } from "zod";
import { createErrorEnvelope } from "@hambazi/contracts";

export const issuanceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: z.uuid(),
  initData: z.string().min(1).max(16384),
});
export const logoutSchema = z.strictObject({ schemaVersion: z.literal(1) });
export const sessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: z.uuid(),
  userId: z.uuid(),
  expiresAt: z.number().int().nonnegative().max(8640000000000),
});
export const issuedSchema = z.strictObject({
  schemaVersion: z.literal(1),
  tokenType: z.literal("Bearer"),
  accessToken: z.string().min(1).max(4096),
  session: sessionSchema,
});
export const inspectedSchema = z.strictObject({
  schemaVersion: z.literal(1),
  session: sessionSchema,
});
export const revokedSchema = z.strictObject({ schemaVersion: z.literal(1), ok: z.literal(true) });
const codes = [
  "INVALID_INPUT",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;
const errorSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: z.enum(codes),
    message: z.string(),
    retryable: z.boolean(),
  }),
});
export const authPaths = Object.freeze({
  issue: "/v1/auth/telegram-mini-app",
  inspect: "/v1/auth/session",
  logout: "/v1/auth/logout",
});

/** Generated from the same feature-owned runtime schemas; no credential-bearing examples. */
export function authOpenApiDocument() {
  const json = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "draft-2020-12" });
  const body = (schema: z.ZodType) => ({
    required: true,
    content: { "application/json": { schema: json(schema) } },
  });
  const responses = (schema: z.ZodType) => ({
    "200": {
      description: "Success; Cache-Control: no-store",
      content: { "application/json": { schema: json(schema) } },
    },
    ...Object.fromEntries(
      [400, 401, 403, 404, 413, 415, 429, 500, 503].map((status) => [
        status,
        {
          description: "Sanitized error; 429 includes Retry-After in seconds",
          content: { "application/json": { schema: json(errorSchema) } },
        },
      ]),
    ),
  });
  return {
    openapi: "3.1.0",
    info: { title: "HamBazi Authentication", version: "1.0.0" },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    },
    paths: {
      [authPaths.issue]: {
        post: {
          operationId: "issueTelegramSession",
          security: [],
          requestBody: body(issuanceSchema),
          responses: responses(issuedSchema),
          description:
            "Existing eligible accounts only. Retry with the same commandId and fresh initData; expiry never extends. No refresh token. Rate-limited retries still count.",
        },
      },
      [authPaths.inspect]: {
        get: {
          operationId: "inspectSession",
          security: [{ bearer: [] }],
          responses: responses(inspectedSchema),
        },
      },
      [authPaths.logout]: {
        post: {
          operationId: "revokeSession",
          security: [{ bearer: [] }],
          requestBody: body(logoutSchema),
          responses: responses(revokedSchema),
          description:
            "Idempotent revocation of the bearer session. Repeating before token expiry succeeds; no new command identifier is needed for this set-to-revoked operation.",
        },
      },
    },
    "x-error-examples": codes.map(createErrorEnvelope),
  };
}

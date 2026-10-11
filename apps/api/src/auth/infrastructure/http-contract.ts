import { z } from "zod";
import { createErrorEnvelope } from "@hambazi/contracts";

export const issuanceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: z.uuid(),
  initData: z.string().min(1).max(16384),
});
export const accountCreationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: z.uuid(),
  initData: z.string().min(1).max(16384),
  // Domain normalization/length rules remain exclusively owned by Users.
  displayName: z.string().min(1).max(256),
});
export const accountCreatedSchema = z.strictObject({
  schemaVersion: z.literal(1),
  account: z.strictObject({
    schemaVersion: z.literal(1),
    userId: z.uuid(),
    displayName: z.string().min(1),
    publicHandle: z.string().min(1),
  }),
  startParam: z.string().max(16384).optional(),
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
export const issuedWithPhotoSchema = issuedSchema.extend({
  photoUrl: z.url().max(2048).optional(),
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
  registeredSession: "/v1/auth/telegram-mini-app/registered-session",
  registeredSessionPhoto: "/v1/auth/telegram-mini-app/registered-session-photo",
  inspect: "/v1/auth/session",
  logout: "/v1/auth/logout",
  createAccount: "/v1/auth/telegram-mini-app/account",
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
      [authPaths.registeredSessionPhoto]: {
        post: {
          operationId: "issueRegisteredTelegramSessionWithPhoto",
          security: [],
          requestBody: body(issuanceSchema),
          responses: {
            ...responses(issuedWithPhotoSchema),
            "403": {
              description:
                "Registration is required after Telegram verification, or the shared HTTPS/origin boundary rejects the request. No session or account is created.",
              content: {
                "application/json": {
                  schema: json(
                    z.strictObject({
                      ok: z.literal(false),
                      error: z.strictObject({
                        code: z.enum(["REGISTRATION_REQUIRED", "FORBIDDEN"]),
                        message: z.string(),
                        retryable: z.boolean(),
                      }),
                    }),
                  ),
                },
              },
            },
          },
          description:
            "Registered session with optional HTTPS Telegram profile photo from freshly validated signed initData. The photo URL is not stored in the account or session database.",
        },
      },
      [authPaths.registeredSession]: {
        post: {
          operationId: "issueRegisteredTelegramSession",
          security: [],
          requestBody: body(issuanceSchema),
          responses: {
            ...responses(issuedSchema),
            "403": {
              description:
                "Registration is required after Telegram verification, or the shared HTTPS/origin boundary rejects the request. No session or account is created.",
              content: {
                "application/json": {
                  schema: json(
                    z.strictObject({
                      ok: z.literal(false),
                      error: z.strictObject({
                        code: z.enum(["REGISTRATION_REQUIRED", "FORBIDDEN"]),
                        message: z.string(),
                        retryable: z.boolean(),
                      }),
                    }),
                  ),
                },
              },
            },
          },
        },
      },
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
      [authPaths.createAccount]: {
        post: {
          operationId: "createTelegramAccount",
          security: [],
          requestBody: body(accountCreationSchema),
          responses: responses(accountCreatedSchema),
          description:
            "Explicit chosen-name registration with fresh verified initData. Retry using the same commandId and fresh initData. Telegram identity and registration completion are idempotent even across different command IDs; completed accounts retain their names and handles. Shares issuance IP/identity rate budgets. startParam is signed opaque routing context, not membership or an arbitrary redirect URL. No session, cookie or credential is issued. Names are plain text requiring escaped rendering. A failed response after commit may leave registration complete; retry recovers it.",
        },
      },
    },
    "x-error-examples": codes.map(createErrorEnvelope),
  };
}

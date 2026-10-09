import { z } from "zod";
import {
  legacyBotOnboardingUpdateSchema,
  legacyBotOnboardingAckSchema,
  botOnboardingUpdateSchema,
  botOnboardingAckSchema,
} from "../application/bot-onboarding.js";
export const botInternalPaths = Object.freeze({
  admit: "/v1/internal/bot/admit",
  process: "/v1/internal/bot/updates",
  acknowledge: "/v1/internal/bot/acknowledgements",
});
export const botExperiencePaths = Object.freeze({
  process: "/v1/internal/bot/experience/updates",
  acknowledge: "/v1/internal/bot/experience/acknowledgements",
});
export const botAdmissionSchema = z.strictObject({ schemaVersion: z.literal(1) });
export const botAdmissionResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ok: z.literal(true),
});
export const botAcknowledgedSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ok: z.literal(true),
  status: z.literal("DONE"),
});
export const legacyBotProcessedSchema = z.discriminatedUnion("status", [
  z.strictObject({
    schemaVersion: z.literal(1),
    ok: z.literal(true),
    status: z.enum(["DONE", "EXPIRED"]),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    ok: z.literal(true),
    status: z.literal("REPLY"),
    delivery: z.strictObject({
      receiptId: z.uuid(),
      version: z.number().int().positive(),
      updateId: z.number().int().nonnegative().max(2147483647),
      chatId: z.string().regex(/^[1-9][0-9]{0,15}$/),
      reply: z.enum([
        "CREATE_ACCOUNT",
        "PROMPT_NAME",
        "INVALID_NAME",
        "MENU",
        "CANCELLED",
        "EXPIRED",
        "DENIED",
      ]),
    }),
  }),
]);
export const botProcessedSchema = z.discriminatedUnion("status", [
  z.strictObject({
    schemaVersion: z.literal(1),
    ok: z.literal(true),
    status: z.enum(["DONE", "EXPIRED"]),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    ok: z.literal(true),
    status: z.literal("REPLY"),
    delivery: z.strictObject({
      receiptId: z.uuid(),
      version: z.number().int().positive(),
      updateId: z.number().int().nonnegative().max(2147483647),
      chatId: z.string().regex(/^[1-9][0-9]{0,15}$/),
      data: z
        .object({
          profile: z
            .object({ userId: z.uuid(), displayName: z.string().max(256), completed: z.boolean() })
            .optional(),
          submissionId: z.uuid().optional(),
        })
        .optional(),
      reply: z.enum([
        "CREATE_ACCOUNT",
        "PROMPT_NAME",
        "INVALID_NAME",
        "MENU",
        "CANCELLED",
        "EXPIRED",
        "DENIED",
        "WELCOME_REGISTERED",
        "REGISTERED",
        "PROFILE",
        "SUPPORT_PROMPT",
        "SUPPORT_DISPATCH",
        "SUPPORT_SENT",
        "SUPPORT_FAILED",
        "SUPPORT_UNKNOWN",
        "SUPPORT_UNAVAILABLE",
        "SUPPORT_TEXT_REQUIRED",
        "SUPPORT_TOO_LONG",
        "SUPPORT_CANCELLED",
      ]),
    }),
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    ok: z.literal(true),
    status: z.literal("SUPPORT"),
    delivery: z.strictObject({
      receiptId: z.uuid(),
      version: z.number().int().positive(),
      updateId: z.number().int().nonnegative(),
      chatId: z.string().regex(/^[1-9][0-9]{0,15}$/),
      reply: z.literal("SUPPORT_DISPATCH"),
      data: z.object({ submissionId: z.uuid() }).optional(),
      submissionId: z.uuid(),
      attemptVersion: z.number().int().positive(),
      adminChatId: z.string().regex(/^[1-9][0-9]{0,15}$/),
      text: z.string().min(1).max(4096),
    }),
  }),
]);
const error = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: z.enum([
      "INVALID_INPUT",
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "NOT_FOUND",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ]),
    message: z.string(),
    retryable: z.boolean(),
  }),
});
export function botInternalOpenApiDocument() {
  const json = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "draft-2020-12" });
  const content = (schema: z.ZodType) => ({ "application/json": { schema: json(schema) } });
  const operation = (body: z.ZodType, response: z.ZodType) => ({
    security: [{ botService: [] }],
    requestBody: { required: true, content: content(body) },
    responses: {
      "200": {
        description:
          "Committed result; REPLY requires send acknowledgement, not webhook completion",
        content: content(response),
      },
      ...Object.fromEntries(
        [400, 401, 403, 404, 413, 415, 429, 500, 503].map((status) => [
          String(status),
          {
            description:
              "Sanitized failure. 429/503 must not acknowledge Telegram delivery; respect Retry-After.",
            content: content(error),
          },
        ]),
      ),
    },
  });
  return {
    openapi: "3.1.0",
    info: { title: "HamBazi internal Bot onboarding", version: "1.0.0" },
    components: {
      securitySchemes: {
        botService: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "keyId.base64url",
          description:
            "Dedicated onboarding service credential; internal-only HTTPS, direct private peers, no proxy/browser access",
        },
      },
    },
    paths: {
      [botExperiencePaths.process]: {
        post: operation(botOnboardingUpdateSchema, botProcessedSchema),
      },
      [botExperiencePaths.acknowledge]: {
        post: operation(botOnboardingAckSchema, botAcknowledgedSchema),
      },
      [botInternalPaths.admit]: { post: operation(botAdmissionSchema, botAdmissionResultSchema) },
      [botInternalPaths.process]: {
        post: operation(legacyBotOnboardingUpdateSchema, legacyBotProcessedSchema),
      },
      [botInternalPaths.acknowledge]: {
        post: operation(legacyBotOnboardingAckSchema, botAcknowledgedSchema),
      },
    },
  };
}

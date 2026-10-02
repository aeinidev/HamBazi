import { z } from "zod";
import { statsResponseSchema, leaderboardResponseSchema } from "../application/contracts.js";
export function statisticsOpenApiDocument() {
  const content = (schema: z.ZodType) => ({
    "application/json": { schema: z.toJSONSchema(schema, { target: "draft-2020-12" }) },
  });
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
  const responses = (schema: z.ZodType) => ({
    "200": {
      description: "Success; no-store; decimal count/rank strings",
      content: content(schema),
    },
    ...Object.fromEntries(
      [400, 401, 403, 404, 413, 415, 429, 500, 503].map((status) => [
        status,
        { description: "Sanitized failure; 429 includes Retry-After", content: content(error) },
      ]),
    ),
  });
  const period = {
    name: "period",
    in: "query",
    required: false,
    schema: { type: "string", enum: ["all_time", "weekly"], default: "all_time" },
  };
  const description =
    "ACTIVE account and valid session required. Unknown/duplicate query fields fail validation. Statistics reads fail closed when the distributed limiter is unavailable. Results are eventually consistent; Monday 00:00 UTC weeks use durable finish time. Bot takeover credit remains with the original account. Counts and ranks are exact decimal strings.";
  return {
    openapi: "3.1.0",
    info: { title: "HamBazi Statistics", version: "1.0.0" },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    },
    paths: {
      "/v1/me/stats": {
        get: {
          operationId: "readOwnStatistics",
          description,
          security: [{ bearer: [] }],
          parameters: [period],
          responses: responses(statsResponseSchema),
        },
      },
      "/v1/leaderboards/{game}": {
        get: {
          operationId: "readLeaderboard",
          description:
            description +
            " Coup Wins only. Ties share competition ranks; opaque ID orders ties. Zero-win participants are included. Names of inactive accounts are replaced with Player. Pagination observes current aggregates and may drift; refresh to restart.",
          security: [{ bearer: [] }],
          parameters: [
            {
              name: "game",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["coup"] },
            },
            period,
            {
              name: "offset",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 0, maximum: 1000000, default: 0 },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 50, default: 50 },
            },
          ],
          responses: responses(leaderboardResponseSchema),
        },
      },
    },
  };
}

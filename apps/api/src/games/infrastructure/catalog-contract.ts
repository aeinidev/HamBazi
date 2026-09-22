import { z } from "zod";
import { gameSchema, slugSchema } from "../application/catalog.js";
export const catalogResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  games: z.array(gameSchema),
});
export const gameResponseSchema = z.strictObject({ schemaVersion: z.literal(1), game: gameSchema });
export function catalogOpenApiDocument() {
  const json = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "draft-2020-12" });
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
  const content = (schema: z.ZodType) => ({ "application/json": { schema: json(schema) } });
  const operation = (id: string, schema: z.ZodType) => ({
    operationId: id,
    security: [{ bearer: [] }],
    description:
      "Authenticated ACTIVE user. Disabled and maintenance metadata is visible but never playable without implementation readiness. No executable descriptor yet. No arbitrary configuration JSON. Shared per-user quota; limiter outage fails open with telemetry, never bypassing authentication or database validation. No-store.",
    responses: {
      "200": { description: "Success", content: content(schema) },
      ...Object.fromEntries(
        [400, 401, 403, 404, 429, 500, 503].map((status) => [
          status,
          { description: "Sanitized failure; 429 includes Retry-After", content: content(error) },
        ]),
      ),
    },
  });
  return {
    openapi: "3.1.0",
    info: { title: "HamBazi Game Catalog", version: "1.0.0" },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    },
    paths: {
      "/v1/games": { get: operation("listGames", catalogResponseSchema) },
      "/v1/games/{slug}": {
        get: {
          ...operation("readGame", gameResponseSchema),
          parameters: [{ name: "slug", in: "path", required: true, schema: json(slugSchema) }],
        },
      },
    },
  };
}

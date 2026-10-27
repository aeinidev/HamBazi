import { z } from "zod";
import {
  adminAccessSchema,
  adminManagementMetaSchema,
  adminActivitySchema,
  adminDirectorySchema,
  adminSessionPageSchema,
  adminCommandPageSchema,
  adminCommandResultSchema,
  adminCommandRequestSchema,
  adminApprovalSchema,
  adminExecuteSchema,
  adminAuditPageSchema,
  adminErrorSchema,
  adminLoginResultSchema,
  adminOverviewSchema,
  adminPageSchema,
} from "@hambazi/validation";
import {
  adminLoginSchema,
  adminPinSchema,
  adminPinChangeSchema,
  adminPasswordChangeSchema,
} from "../application/service.js";

/** Authenticated Admin contract, generated separately from the player API. */
export function adminOpenApiDocument() {
  const json = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input" });
  const response = (schema: z.ZodType) => ({
    description: "Successful response",
    content: { "application/json": { schema: json(schema) } },
  });
  const errors = Object.fromEntries(
    [400, 401, 403, 404, 409, 429, 503].map((code) => [String(code), response(adminErrorSchema)]),
  );
  const ok = z.strictObject({ schemaVersion: z.literal(1), ok: z.literal(true) });
  const command = z.strictObject({ schemaVersion: z.literal(1), commandId: z.uuid() });
  const post = (input: z.ZodType, output: z.ZodType, security: unknown[], csrf: boolean) => ({
    security,
    parameters: csrf
      ? [{ in: "header", name: "X-CSRF-Token", required: true, schema: { type: "string" } }]
      : [],
    requestBody: { required: true, content: { "application/json": { schema: json(input) } } },
    responses: { "201": response(output), ...errors },
  });
  const full = [{ adminCookie: [] }],
    pending = [{ pendingCookie: [] }];
  const paths: Record<string, unknown> = {
    "/v1/admin/auth/login": { post: post(adminLoginSchema, adminLoginResultSchema, [], false) },
    "/v1/admin/auth/pin": { post: post(adminPinSchema, adminLoginResultSchema, pending, true) },
    "/v1/admin/auth/logout": { post: post(command, ok, full, true) },
    "/v1/admin/auth/pin/change": { post: post(adminPinChangeSchema, ok, full, true) },
    "/v1/admin/auth/password/change": { post: post(adminPasswordChangeSchema, ok, full, true) },
    "/v1/admin/me/access": {
      get: { security: full, responses: { "200": response(adminAccessSchema), ...errors } },
    },
    "/v1/admin/session": {
      get: {
        security: full,
        responses: {
          "200": response(
            z.strictObject({
              schemaVersion: z.literal(1),
              expiresAt: z.iso.datetime(),
              csrfToken: z.string(),
            }),
          ),
          ...errors,
        },
      },
    },
  };
  const pathId = {
    in: "path",
    name: "id",
    required: true,
    schema: { type: "string", format: "uuid" },
  };
  for (const [path, schema] of [
    ["management/meta", adminManagementMetaSchema],
    ["admins", adminDirectorySchema],
    ["admins/{id}/sessions", adminSessionPageSchema],
    ["admins/{id}/activity", adminActivitySchema],
    ["operations", adminCommandPageSchema],
    ["operations/{id}", adminCommandResultSchema],
  ] as const)
    paths[`/v1/admin/${path}`] = {
      get: {
        security: full,
        parameters: path.includes("{id}")
          ? [pathId]
          : path === "admins"
            ? [{ in: "query", name: "cursor", schema: { type: "string", format: "uuid" } }]
            : [],
        responses: { "200": response(schema), ...errors },
      },
    };
  paths["/v1/admin/operations"] = {
    ...(paths["/v1/admin/operations"] as object),
    post: post(adminCommandRequestSchema, adminCommandResultSchema, full, true),
  };
  for (const [path, input, output] of [
    ["approve", adminApprovalSchema, adminLoginResultSchema],
    ["execute", adminExecuteSchema, adminCommandResultSchema],
    ["renew", adminExecuteSchema, adminCommandResultSchema],
  ] as const) {
    const operation = post(input, output, full, true);
    paths[`/v1/admin/operations/{id}/${path}`] = {
      post: { ...operation, parameters: [...operation.parameters, pathId] },
    };
  }
  for (const kind of ["users", "games", "rooms", "matches"]) {
    paths[`/v1/admin/${kind}`] = {
      get: {
        security: full,
        parameters: [
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 50 } },
          { in: "query", name: "cursor", schema: { type: "string", maxLength: 128 } },
        ],
        responses: { "200": response(adminPageSchema), ...errors },
      },
    };
    paths[`/v1/admin/${kind}/{id}`] = {
      get: {
        security: full,
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: {
              type: "string",
              ...(kind === "games" ? { pattern: "^[a-z][a-z0-9-]{0,63}$" } : { format: "uuid" }),
            },
          },
        ],
        responses: { "200": response(adminPageSchema), ...errors },
      },
    };
  }
  for (const path of ["overview", "monitoring/summary", "audit-events"])
    paths[`/v1/admin/${path}`] = {
      get: {
        security: full,
        responses: {
          "200": response(path === "audit-events" ? adminAuditPageSchema : adminOverviewSchema),
          ...errors,
        },
      },
    };
  return {
    openapi: "3.1.0",
    info: { title: "HamBazi Admin API", version: "1.2.0" },
    paths,
    components: {
      securitySchemes: {
        adminCookie: { type: "apiKey", in: "cookie", name: "__Host-hambazi-admin" },
        pendingCookie: { type: "apiKey", in: "cookie", name: "__Host-hambazi-admin-pending" },
      },
    },
  };
}

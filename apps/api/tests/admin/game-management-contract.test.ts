import { describe, expect, it } from "vitest";
import { adminOpenApiDocument } from "../../src/admin/infrastructure/contract.js";

describe("Admin game management OpenAPI", () => {
  it.each([
    ["games/search", ["cursor", "limit", "search", "status", "gameId"]],
    ["rooms/search", ["cursor", "limit", "search", "status", "gameId", "createdFrom", "createdTo"]],
    [
      "matches/search",
      ["cursor", "limit", "search", "status", "gameId", "playerId", "createdFrom", "createdTo"],
    ],
  ])("declares the accepted filters and strict resource page for %s", (path, names) => {
    const operation = adminOpenApiDocument().paths[`/v1/admin/${path}`] as {
      get: {
        security: unknown;
        parameters: { name: string; schema: { pattern?: string } }[];
        responses: Record<
          string,
          {
            content: Record<
              string,
              { schema: { additionalProperties: boolean; properties: Record<string, unknown> } }
            >;
          }
        >;
      };
    };
    expect(operation).toBeDefined();
    expect(operation.get.security).toEqual([{ adminCookie: [] }]);
    expect(operation.get.parameters.map((p) => p.name)).toEqual(names);
    const limitPattern = new RegExp(
      operation.get.parameters.find((p) => p.name === "limit")!.schema.pattern!,
    );
    expect(limitPattern.test("50")).toBe(true);
    expect(limitPattern.test("51")).toBe(false);
    const page = operation.get.responses["200"]!.content["application/json"]!.schema;
    expect(page.additionalProperties).toBe(false);
    expect(page.properties).toHaveProperty("asOf");
    expect(page.properties).toHaveProperty("nextCursor");
  });

  it.each([
    ["games/{id}/details", "item"],
    ["rooms/{id}/details", "item"],
    ["matches/{id}/details", "item"],
    ["rooms/{id}/players", "items"],
    ["matches/{id}/players", "items"],
    ["matches/{id}/history", "results"],
    ["rooms/{id}/diagnostics", "reason"],
    ["matches/{id}/diagnostics", "reason"],
  ])("declares a typed authenticated response for %s", (path, field) => {
    const operation = adminOpenApiDocument().paths[`/v1/admin/${path}`] as {
      get: {
        security: unknown;
        parameters: { in: string; name: string; schema: Record<string, unknown> }[];
        responses: Record<
          string,
          {
            content: Record<
              string,
              { schema: { additionalProperties: boolean; properties: Record<string, unknown> } }
            >;
          }
        >;
      };
    };
    expect(operation).toBeDefined();
    expect(operation.get.security).toEqual([{ adminCookie: [] }]);
    expect(operation.get.parameters[0]).toMatchObject({ in: "path", name: "id" });
    if (path.endsWith("/history")) {
      expect(operation.get.parameters.map((p) => p.name)).toEqual(["id", "cursor", "limit"]);
      expect(operation.get.parameters[1]!.schema).toMatchObject({
        type: "string",
        pattern: "^[1-9][0-9]{0,9}$",
      });
    }
    const result = operation.get.responses["200"]!.content["application/json"]!.schema;
    expect(result.additionalProperties).toBe(false);
    expect(result.properties).toHaveProperty(field);
    expect(result.properties).toHaveProperty("asOf");
  });
});

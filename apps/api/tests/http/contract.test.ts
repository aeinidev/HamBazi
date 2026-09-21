import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authOpenApiDocument } from "../../src/auth/index.js";
import { compatibleAuthContract } from "../../scripts/contract-compatibility.mjs";
const baseline = () =>
  JSON.parse(
    readFileSync(
      new URL("../../../../docs/contracts/auth.v1.baseline.json", import.meta.url),
      "utf8",
    ),
  );
describe("version-1 compatibility gate", () => {
  it("matches the reviewed v1 wire contract including additive onboarding", () =>
    expect(compatibleAuthContract(baseline(), authOpenApiDocument())).toBe(true));
  it.each(["remove", "identity", "token", "routing"])(
    "protects the approved onboarding contract against %s drift",
    (kind) => {
      const next = baseline();
      const path = "/v1/auth/telegram-mini-app/account";
      const operation = next.paths[path].post;
      if (kind === "remove") delete next.paths[path];
      if (kind === "identity")
        operation.requestBody.content["application/json"].schema.required.push("telegramUserId");
      if (kind === "token")
        operation.responses["200"].content["application/json"].schema.required.push("accessToken");
      if (kind === "routing")
        delete operation.responses["200"].content["application/json"].schema.properties.startParam;
      expect(compatibleAuthContract(baseline(), next)).toBe(false);
    },
  );
  it("permits a new path and description edits", () => {
    const next = baseline();
    next.paths["/v2/auth/example"] = {};
    next.paths["/v1/auth/telegram-mini-app"].post.description = "Improved documentation";
    expect(compatibleAuthContract(baseline(), next)).toBe(true);
  });
  it.each(["path", "security", "request", "response", "version"])(
    "rejects changed %s semantics",
    (kind) => {
      const next = baseline();
      const post = next.paths["/v1/auth/telegram-mini-app"].post;
      if (kind === "path") delete next.paths["/v1/auth/telegram-mini-app"];
      if (kind === "security") post.security = [{ bearer: [] }];
      if (kind === "request")
        post.requestBody.content["application/json"].schema.required.push("userId");
      if (kind === "response")
        delete post.responses["200"].content["application/json"].schema.properties.accessToken;
      if (kind === "version") next.openapi = "3.0.0";
      expect(compatibleAuthContract(baseline(), next)).toBe(false);
    },
  );
});

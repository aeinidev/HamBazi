import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const candidate = readFileSync("infra/docker/admin/public-https.conf", "utf8");
const block = candidate.match(
  /map "\$request_method:\$uri" \$hambazi_admin_api_allowed \{([\s\S]*?)\n\}/,
)[1];
const entries = block
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith(" 1;"));
const allowed = (method, path) =>
  entries.some((line) => {
    const key = line.slice(0, -3).trim(),
      input = method + ":" + path;
    const decoded = key.startsWith('"') ? JSON.parse(key) : key;
    return decoded.startsWith("~") ? new RegExp(decoded.slice(1)).test(input) : decoded === input;
  });
describe("Admin ingress vs independent API contract", () => {
  it("admits every method/path actually published in the Admin OpenAPI contract", () => {
    const contract = JSON.parse(readFileSync("docs/contracts/admin.openapi.json", "utf8"));
    for (const [path, methods] of Object.entries(contract.paths))
      for (const method of Object.keys(methods))
        expect(
          allowed(
            method.toUpperCase(),
            path.replace("{id}", "11111111-1111-4111-8111-111111111111"),
          ),
          `${method} ${path}`,
        ).toBe(true);
  });
  it("keeps private ceremonies, player APIs and unintended methods closed", () => {
    for (const path of [
      "/v1/admin/auth/bootstrap",
      "/v1/admin/auth/recovery",
      "/v1/admin/auth/unlock",
      "/v1/admin/auth/signup",
      "/v1/admin/auth/forgot",
      "/v1/health/ready",
      "/v1/users/me",
    ])
      for (const method of ["GET", "POST"]) expect(allowed(method, path)).toBe(false);
    for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
      for (const path of ["/v1/admin/users", "/v1/admin/auth/login"])
        expect(allowed(method, path)).toBe(false);
  });
});

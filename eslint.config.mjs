import { defineConfig } from "eslint/config";
import { fileURLToPath } from "node:url";
import { base, node, browser, architecture } from "@hambazi/eslint";

export default defineConfig([
  { ignores: ["packages/database/src/generated/**"] },
  base,
  architecture(fileURLToPath(new URL(".", import.meta.url))),
  {
    files: [
      "*.mjs",
      "tooling/**/*.{js,mjs,cjs,ts}",
      "apps/{api,bot,worker}/src/**/*.ts",
      "apps/web/tests/**/*.mjs",
      "apps/web/dev/**/*.mjs",
      "packages/config/**/*.ts",
      "packages/database/**/*.{ts,mjs}",
      "infra/**/*.mjs",
    ],
    extends: [node],
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    extends: [browser],
  },
]);

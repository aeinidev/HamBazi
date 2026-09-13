import { defineConfig } from "eslint/config";
import { base, node, browser } from "@hambazi/eslint";

export default defineConfig([
  { ignores: ["packages/database/src/generated/**"] },
  base,
  {
    files: [
      "*.mjs",
      "tooling/**/*.{js,mjs,cjs,ts}",
      "apps/{api,bot,worker}/src/**/*.ts",
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

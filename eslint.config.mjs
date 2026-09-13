import { defineConfig } from "eslint/config";
import { base, node, browser } from "@hambazi/eslint";

export default defineConfig([
  base,
  {
    files: [
      "*.mjs",
      "tooling/**/*.{js,mjs,cjs,ts}",
      "apps/{api,bot,worker}/src/**/*.ts",
      "packages/config/**/*.ts",
      "infra/**/*.mjs",
    ],
    extends: [node],
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    extends: [browser],
  },
]);

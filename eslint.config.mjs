import { defineConfig } from "eslint/config";
import { base, node } from "@hambazi/eslint";

export default defineConfig([
  base,
  {
    files: ["*.mjs", "tooling/**/*.{js,mjs,cjs,ts}"],
    extends: [node],
  },
]);

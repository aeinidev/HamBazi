import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";
import tseslint from "typescript-eslint";

export const base = defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.turbo/**",
    "**/.pnpm-store/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/playwright-report/**",
    "**/test-results/**",
  ]),
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,tsx}"],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022 },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: { eqeqeq: ["error", "always"] },
  },
  {
    files: ["**/*.{ts,mts,cts,tsx}"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
]);

// Runtime globals are opt-in and must be scoped by each consumer's file globs.
export const node = { languageOptions: { globals: globals.node } };
export const browser = { languageOptions: { globals: globals.browser } };

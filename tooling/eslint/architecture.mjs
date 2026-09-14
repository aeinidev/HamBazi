import tseslint from "typescript-eslint";
import { createPolicy, sourcePatterns } from "./architecture-policy.mjs";
import { architecturePlugin } from "./architecture-rules.mjs";

export function architecture(root, workspaces) {
  const policy = createPolicy(root, workspaces);
  return {
    files: sourcePatterns,
    ignores: ["packages/database/src/generated/**"],
    languageOptions: { parser: tseslint.parser },
    plugins: { hambazi: architecturePlugin(policy) },
    rules: {
      "hambazi/boundaries": "error",
      "hambazi/engine-determinism": "error",
      "hambazi/database-ownership": "error",
    },
  };
}

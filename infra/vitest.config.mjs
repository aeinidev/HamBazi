import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
// Execute repository tests only; archived candidate trees under ignored test-results are not source.
export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  test: { include: ["infra/tests/**/*.test.mjs"] },
});

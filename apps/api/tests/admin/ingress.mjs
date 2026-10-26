import { spawnSync } from "node:child_process";
import process from "node:process";
// No target URL, remote context or user-provided database is accepted.
const result = spawnSync("pnpm", ["exec", "vitest", "run", "tests/ingress/admin-public.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, TEST_ADMIN_INGRESS_CONFIRM: "owned-local-only" },
});
process.exitCode = result.status ?? 1;

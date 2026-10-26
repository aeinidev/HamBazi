import { access, lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { verifyTool } from "../scripts/security-scan.mjs";
import { validateCheckedWorkflow } from "./workflow-policy.mjs";
import { runGate, runSequence } from "./gates.mjs";
import { writeEvidence } from "./evidence.mjs";

let stage = "workflow-policy";
try {
  const root = await validateCheckedWorkflow();
  stage = "toolchain";
  const pins = JSON.parse(await readFile(join(root, "infra/ci/toolchain.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (
    process.versions.node !== pins.nodeVersion ||
    (await runGate("pnpm-version", "pnpm", ["--version"])).trim() !==
      manifest.packageManager.split("@").at(-1)
  )
    throw new Error();
  if (
    (
      await runGate("docker-version", "docker", ["version", "--format", "{{.Server.Version}}"])
    ).trim() !== pins.dockerVersion
  )
    throw new Error();
  if (
    !process.env.TEST_POSTGRES_BIN ||
    !process.env.SECURITY_SCANNER_DIR ||
    !process.env.RUNNER_TEMP
  )
    throw new Error();
  await access(join(root, ".env")).then(
    () => {
      throw new Error();
    },
    (error) => {
      if (error.code !== "ENOENT") throw new Error();
    },
  );
  for (const tool of ["gitleaks", "trivy"])
    await verifyTool(join(process.env.SECURITY_SCANNER_DIR, tool), tool);
  const actionlint = join(process.env.SECURITY_SCANNER_DIR, "actionlint");
  const info = await lstat(actionlint);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    createHash("sha256")
      .update(await readFile(actionlint))
      .digest("hex") !== pins.actionlint.binarySha256
  )
    throw new Error();
  await access(actionlint, constants.X_OK);
  const compose = parse(await readFile(join(root, "infra/docker/compose.yaml"), "utf8"));
  const adminIngressFixture = JSON.parse(
    await readFile(join(root, "infra/docker/admin/test-image.json"), "utf8"),
  );
  const gate = (name, command, args, env = {}, timeout = 600000) => ({
    stage: name,
    command,
    args,
    options: {
      cwd: root,
      env: {
        ...process.env,
        TURBO_FORCE: "true",
        TURBO_CACHE: "local:rw",
        TURBO_CONCURRENCY: "1",
        PLAYWRIGHT_NO_COPY_PROMPT: "1",
        ...env,
      },
      timeout,
    },
  });
  const gates = await runSequence([
    gate("workflow-lint", actionlint, ["-color", "-shellcheck=", ".github/workflows/ci.yml"]),
    gate("secrets", "node", ["infra/scripts/security-scan.mjs", "secrets"]),
    gate("dependencies", "node", ["infra/scripts/security-scan.mjs", "dependencies"]),
    // Contract CLIs and integration fixtures consume compiled public module surfaces.
    gate("compiled-public-surfaces", "pnpm", ["build"]),
    gate("root-quality", "pnpm", ["check"]),
    gate("contracts-check", "pnpm", ["--filter", "@hambazi/api", "contract:check"]),
    gate("contracts-generate", "pnpm", ["--filter", "@hambazi/api", "contract:generate"]),
    gate("contracts-format", "pnpm", ["exec", "prettier", "--write", "docs/contracts"]),
    gate("contracts-diff", "git", ["diff", "--exit-code", "--", "docs/contracts"]),
    gate("bot-integration", "pnpm", ["--filter", "@hambazi/bot", "test:integration"]),
    gate("postgres-image-build", "node", [
      "--use-env-proxy",
      "infra/scripts/build-local-postgres.mjs",
    ]),
    gate("redis-image-pull", "docker", ["pull", compose.services.redis.image]),
    gate("admin-postgres-image-pull", "docker", [
      "pull",
      "postgres@sha256:3725f4e2499eef5134592b3b4ab79a543ed7f8e533b05b5b637af926630f6650",
    ]),
    gate("admin-integration", "pnpm", ["--filter", "@hambazi/api", "test:admin:local"]),
    gate("admin-private-node-image-pull", "docker", [
      "pull",
      JSON.parse(await readFile(join(root, "infra/docker/apps/base-lock.json"), "utf8")).image,
    ]),
    gate("admin-private-files-and-tty", "pnpm", ["--filter", "@hambazi/api", "test:admin:private"]),
    gate("admin-ingress-image-pull", "docker", ["pull", adminIngressFixture.image]),
    gate("admin-ingress", "pnpm", ["--filter", "@hambazi/api", "test:admin:ingress"]),
    gate("admin-browser", "pnpm", ["--filter", "@hambazi/admin", "test:browser"]),
    gate("images", "node", ["infra/scripts/security-scan.mjs", "images"]),
    gate(
      "application-image-build",
      "node",
      [
        "--use-env-proxy",
        "infra/release/build.mjs",
        join(process.env.RUNNER_TEMP, "hambazi-packaging"),
      ],
      {},
      900000,
    ),
    gate("application-images", "node", [
      "infra/release/scan.mjs",
      join(process.env.RUNNER_TEMP, "hambazi-packaging/images.json"),
    ]),
    gate("application-image-smoke", "node", [
      "infra/release/test-local.mjs",
      join(process.env.RUNNER_TEMP, "hambazi-packaging/images.json"),
    ]),
    gate("migration-fault-release", "pnpm", ["test:auth-http:local"], {
      TEST_POSTGRES_MODE: "compose",
      TEST_RESTORE_DRILL: "isolated",
      TEST_RELEASE_BROWSER: "isolated",
    }),
    gate("ordinary-browser", "pnpm", ["--filter", "@hambazi/web", "test:browser"]),
    gate("built-sdk-browser", "pnpm", [
      "--filter",
      "@hambazi/web",
      "test:browser",
      "--config",
      "telegram-production.playwright.config.ts",
    ]),
    gate("preview-isolation", "pnpm", ["--filter", "@hambazi/web", "test:preview"]),
    gate("normal-web-build", "pnpm", ["--filter", "@hambazi/web", "build"]),
  ]);
  stage = "evidence";
  await writeEvidence(root, join(process.env.RUNNER_TEMP, "hambazi-ci-evidence"), gates);
  console.info("CI correctness and supply-chain gates passed; production release is not approved.");
} catch (error) {
  const fixed = /^CI_GATE_FAILED:[a-z][a-z0-9-]{0,60}$/.test(error?.message ?? "")
    ? error.message
    : `CI_VERIFICATION_FAILED:${stage}`;
  console.error(`${fixed}; raw command, test and service diagnostics are suppressed.`);
  process.exitCode = 1;
}

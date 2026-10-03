import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = new URL("../../", import.meta.url);
const pins = JSON.parse(await readFile(new URL("infra/ci/toolchain.json", root), "utf8"));
export const trustedArtifactCondition =
  "github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && github.event_name != 'merge_group'";
const fail = () => {
  throw new Error("CI_WORKFLOW_POLICY_FAILED");
};

/** Enforce the trust boundary in addition to actionlint's syntax/expression checks. */
export function validateWorkflow(workflow) {
  if (!workflow || JSON.stringify(workflow.permissions) !== '{"contents":"read"}') fail();
  const events = Object.keys(workflow.on ?? {}).sort();
  if (
    JSON.stringify(events) !==
    JSON.stringify(["merge_group", "pull_request", "push", "schedule", "workflow_dispatch"])
  )
    fail();
  for (const event of ["push", "pull_request", "merge_group", "workflow_dispatch"])
    if (workflow.on[event] !== null) fail(); // No path/branch filtering or approval switches.
  if (JSON.stringify(Object.keys(workflow.jobs ?? {})) !== '["verify"]') fail();
  const job = workflow.jobs.verify;
  if (
    job["runs-on"] !== "ubuntu-24.04" ||
    job.permissions ||
    job.if ||
    job.strategy ||
    job["continue-on-error"] ||
    job["timeout-minutes"] !== 45
  )
    fail();
  if (job.defaults?.run?.shell !== "bash") fail();
  const steps = job.steps;
  if (!Array.isArray(steps) || steps.length === 0) fail();
  const seen = new Set();
  for (const step of steps) {
    if (step["continue-on-error"] || step.env || step.shell || step["working-directory"]) fail();
    if (step.run && (step.if || step.run.includes("${{"))) fail();
    if (step.uses) {
      const [action, sha] = step.uses.split("@");
      if (!/^[a-f0-9]{40}$/.test(sha ?? "") || pins.actions[action] !== sha || seen.has(action))
        fail();
      seen.add(action);
      if (
        action === "actions/checkout" &&
        (step.with?.["fetch-depth"] !== 0 || step.with?.["persist-credentials"] !== false)
      )
        fail();
      if (
        action === "actions/setup-node" &&
        (step.with?.["node-version"] !== pins.nodeVersion ||
          step.with?.["package-manager-cache"] !== false ||
          step.with?.cache)
      )
        fail();
      if (
        action === "docker/setup-docker-action" &&
        (step.with?.version !== `v${pins.dockerVersion}` ||
          JSON.parse(step.with?.["daemon-config"] ?? "{}").features?.["containerd-snapshotter"] !==
            true)
      )
        fail();
      if (action === "actions/upload-artifact") {
        if (
          step.if !== trustedArtifactCondition ||
          step.with?.path !== "${{ runner.temp }}/hambazi-ci-evidence/manifest.json" ||
          step.with?.["include-hidden-files"] !== false ||
          step.with?.overwrite !== false ||
          step.with?.["if-no-files-found"] !== "error"
        )
          fail();
      } else if (step.if) fail();
    }
  }
  if (seen.size !== Object.keys(pins.actions).length) fail();
  for (const command of [
    "pnpm install --frozen-lockfile",
    "node infra/ci/provision-tools.mjs",
    "bash infra/ci/provision-postgres.sh",
    "node infra/ci/verify.mjs",
  ])
    if (steps.filter((step) => step.run === command).length !== 1) fail();
  const install = steps.findIndex((step) => step.run === "pnpm install --frozen-lockfile");
  const verify = steps.findIndex((step) => step.run === "node infra/ci/verify.mjs");
  const upload = steps.findIndex((step) => step.uses?.startsWith("actions/upload-artifact@"));
  if (!(install < verify && verify < upload)) fail();
  if (
    job.env?.TURBO_FORCE !== "true" ||
    job.env?.TURBO_CACHE !== "local:rw" ||
    job.env?.TURBO_CONCURRENCY !== "1" ||
    job.env?.PLAYWRIGHT_NO_COPY_PROMPT !== "1"
  )
    fail();
  if (
    /secrets\.|pull_request_target|workflow_run|ACTIONS_STEP_DEBUG/.test(JSON.stringify(workflow))
  )
    fail();
}

export async function validateCheckedWorkflow() {
  validateWorkflow(parse(await readFile(new URL(".github/workflows/ci.yml", root), "utf8")));
  return fileURLToPath(root);
}

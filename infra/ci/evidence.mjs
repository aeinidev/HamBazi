import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { runGate } from "./gates.mjs";
import { projectScan } from "./scan-evidence.mjs";

const digest = (data) => createHash("sha256").update(data).digest("hex");
const invalid = () => {
  throw new Error("CI_EVIDENCE_INVALID");
};

export function releaseGateStates(plan) {
  return ["7C", "17C", "18B", "19"].map((phase) => {
    const sections = [
      ...plan.matchAll(new RegExp(`^### Phase ${phase} —[^]*?(?=^### Phase |^## |$(?![^]))`, "gm")),
    ];
    if (sections.length !== 1) invalid();
    const status = /^- \*\*Status:\*\* (Pending|In Progress|Completed|Blocked)\b/m.exec(
      sections[0][0],
    )?.[1];
    if (!status) invalid();
    return { phase, status };
  });
}

async function inventory(root, path, output) {
  const info = await lstat(join(root, path));
  if (
    info.isSymbolicLink() ||
    !/^[a-zA-Z0-9_./-]{1,250}$/.test(path) ||
    path.split("/").some((part) => part.startsWith("."))
  )
    invalid();
  if (info.isDirectory()) {
    const names = await readdir(join(root, path));
    if (!names.length) invalid();
    for (const name of names.sort()) await inventory(root, `${path}/${name}`, output);
  } else {
    if (
      !info.isFile() ||
      info.size > 64 * 1024 * 1024 ||
      output.length >= 5000 ||
      !/\.(?:js|json|css|html|map|ts)$/.test(path)
    )
      invalid();
    output.push({ path, bytes: info.size, sha256: digest(await readFile(join(root, path))) });
  }
}

/** Content-free build evidence only; this never authorizes promotion or deployment. */
export async function writeEvidence(root, directory, gates, environment = process.env) {
  if (!isAbsolute(directory ?? "") || !relative(root, directory).startsWith("../")) invalid();
  if (
    (
      await runGate("clean-source", "git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: root,
      })
    ).trim()
  )
    invalid();
  const commit = (
    await runGate("source-commit", "git", ["rev-parse", "HEAD"], { cwd: root })
  ).trim();
  const tree = (
    await runGate("source-tree", "git", ["rev-parse", "HEAD^{tree}"], { cwd: root })
  ).trim();
  if (
    !/^[a-f0-9]{40}$/.test(commit) ||
    !/^[a-f0-9]{40}$/.test(tree) ||
    (environment.GITHUB_SHA && environment.GITHUB_SHA !== commit)
  )
    invalid();
  const headers = JSON.parse(
    await readFile(join(root, "apps/web/dist/client/security-headers.json"), "utf8"),
  );
  if (headers.profile !== "production" || JSON.stringify(headers).includes("127.0.0.1")) invalid();
  const files = [];
  for (const path of ["apps/api/dist", "apps/bot/dist", "apps/worker/dist", "apps/web/dist/client"])
    await inventory(root, path, files);
  for (const name of (await readdir(join(root, "docs/contracts"))).sort())
    if (name.endsWith(".openapi.json") || name === "realtime.events.json")
      await inventory(root, `docs/contracts/${name}`, files);
  if (
    !Array.isArray(gates) ||
    gates.length === 0 ||
    gates.some((gate) => gate.passed !== true || !/^[a-z][a-z0-9-]{0,60}$/.test(gate.stage))
  )
    invalid();
  for (const gate of gates)
    if (
      gate.stage === "application-images" &&
      (gate.scan?.sourceCommit !== commit || gate.scan?.sourceDirty !== false)
    )
      invalid();
  const manifest = {
    schemaVersion: 1,
    purpose: "ci-quality-evidence",
    productionReleaseApproved: false,
    commit,
    tree,
    nodeVersion: process.versions.node,
    pnpmVersion: (await runGate("pnpm-version", "pnpm", ["--version"], { cwd: root })).trim(),
    lockfileSha256: digest(await readFile(join(root, "pnpm-lock.yaml"))),
    schemaSha256: digest(await readFile(join(root, "packages/database/prisma/schema.prisma"))),
    toolchainSha256: digest(await readFile(join(root, "infra/ci/toolchain.json"))),
    scanPolicySha256: digest(await readFile(join(root, "infra/security/policy.json"))),
    releaseGates: releaseGateStates(
      await readFile(join(root, "docs/implementation-plan.md"), "utf8"),
    ),
    gates: gates.map((gate) => {
      const scalar = (field) => {
        if (!Number.isSafeInteger(gate[field]) || gate[field] < 0) invalid();
        return gate[field];
      };
      return {
        stage: gate.stage,
        passed: true,
        ...(gate.scan ? { scan: projectScan(gate.scan, gate.stage) } : {}),
        durationMs: scalar("durationMs"),
        tests: scalar("tests"),
        browserCases: scalar("browserCases"),
        ...(gate.runtimeChecks !== undefined ? { runtimeChecks: scalar("runtimeChecks") } : {}),
      };
    }),
    files,
  };
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return manifest;
}

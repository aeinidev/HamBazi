import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";
import { expect, it } from "vitest";
import { validateWorkflow } from "../ci/workflow-policy.mjs";
import { runGate, runSequence } from "../ci/gates.mjs";
import { verifyBytes, provisionTools } from "../ci/provision-tools.mjs";
import { releaseGateStates, writeEvidence } from "../ci/evidence.mjs";
import { projectScan } from "../ci/scan-evidence.mjs";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const workflow = parse(await readFile(join(root, ".github/workflows/ci.yml"), "utf8"));
const plan = await readFile(join(root, "docs/implementation-plan.md"), "utf8");
const pendingPlan = ["7C", "17C", "18B", "19"]
  .map((phase) => `### Phase ${phase} — synthetic\n\n- **Status:** Pending\n`)
  .join("\n");
const action = (w, name) => w.jobs.verify.steps.find((step) => step.uses?.startsWith(`${name}@`));

it("retains every workspace quality task in one forced Turbo graph and the non-Turbo checks", async () => {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  for (const command of [
    "pnpm format:check",
    "pnpm lint",
    "pnpm check:architecture",
    "pnpm test:infra",
    "pnpm --filter @hambazi/api contract:check",
  ])
    expect(manifest.scripts.check.split(" && ")).toContain(command);
  const taskCommand = manifest.scripts.check
    .split(" && ")
    .filter((command) => command.startsWith("turbo run "));
  expect(taskCommand).toHaveLength(1);
  const tasks = taskCommand[0].slice("turbo run ".length).split(" ");
  expect(tasks.sort()).toEqual(["build", "test", "typecheck"]);
  const output = await execute("pnpm", ["exec", "turbo", "run", ...tasks, "--dry=json"], {
    cwd: root,
    maxBuffer: 4 * 1024 * 1024,
  });
  const graph = JSON.parse(output.stdout);
  const ids = graph.tasks
    .filter((task) => task.command !== "<NONEXISTENT>")
    .map((task) => task.taskId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const parent of ["apps", "packages", "packages/games", "tooling"])
    for (const entry of await readdir(join(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(root, parent, entry.name, "package.json");
      const data = await readFile(path, "utf8").catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!data) continue;
      const workspace = JSON.parse(data);
      for (const task of tasks)
        if (workspace.scripts?.[task]) expect(ids).toContain(`${workspace.name}#${task}`);
    }
});

it("accepts reviewed workflow trust boundaries and keeps deferred capacity as a release gate", () => {
  validateWorkflow(workflow);
  expect(releaseGateStates(pendingPlan).find((gate) => gate.phase === "17C")).toEqual({
    phase: "17C",
    status: "Pending",
  });
  // Later authorized capacity work can update the real plan without rewriting CI tests.
  expect(releaseGateStates(plan).map((gate) => gate.phase)).toContain("17C");
});
for (const [name, mutate] of [
  [
    "previous Docker minor",
    (w) => {
      action(w, "docker/setup-docker-action").with.version = "v29.8.2";
    },
  ],
  [
    "older Docker patch",
    (w) => {
      action(w, "docker/setup-docker-action").with.version = "v29.8.1";
    },
  ],
  [
    "disabled containerd snapshotter",
    (w) => {
      action(w, "docker/setup-docker-action").with["daemon-config"] = JSON.stringify({
        features: { "containerd-snapshotter": false },
      });
    },
  ],
  [
    "write permission",
    (w) => {
      w.permissions.contents = "write";
    },
  ],
  [
    "privileged PR event",
    (w) => {
      w.on.pull_request_target = null;
    },
  ],
  [
    "filtered required check",
    (w) => {
      w.on.pull_request = { paths: ["apps/**"] };
    },
  ],
  [
    "shallow history",
    (w) => {
      action(w, "actions/checkout").with["fetch-depth"] = 1;
    },
  ],
  [
    "retained checkout credential",
    (w) => {
      action(w, "actions/checkout").with["persist-credentials"] = true;
    },
  ],
  [
    "mutable action",
    (w) => {
      action(w, "actions/checkout").uses = "actions/checkout@main";
    },
  ],
  [
    "shared package cache",
    (w) => {
      action(w, "actions/setup-node").with["package-manager-cache"] = true;
    },
  ],
  [
    "oversubscribed CI tasks",
    (w) => {
      w.jobs.verify.env.TURBO_CONCURRENCY = "10";
    },
  ],
  [
    "failure allowed",
    (w) => {
      w.jobs.verify["continue-on-error"] = true;
    },
  ],
  [
    "skipped verification",
    (w) => {
      w.jobs.verify.steps.find((s) => s.run === "node infra/ci/verify.mjs").if = "false";
    },
  ],
  [
    "untrusted shell expression",
    (w) => {
      w.jobs.verify.steps[2].run = "echo ${{ github.event.pull_request.title }}";
    },
  ],
  [
    "production secret",
    (w) => {
      w.jobs.verify.env.PRIVATE = "${{ secrets.PRODUCTION_DATABASE }}";
    },
  ],
  [
    "arbitrary artifact capture",
    (w) => {
      action(w, "actions/upload-artifact").with.path = "**/*";
    },
  ],
  [
    "PR artifact promotion",
    (w) => {
      action(w, "actions/upload-artifact").if = "always()";
    },
  ],
  [
    "replaceable evidence",
    (w) => {
      action(w, "actions/upload-artifact").with.overwrite = true;
    },
  ],
]) {
  it(`rejects ${name} without relaxing mandatory gates`, () => {
    const changed = structuredClone(workflow);
    mutate(changed);
    expect(() => validateWorkflow(changed)).toThrow();
  });
}

it("hash verification refuses substituted archive bytes", () => {
  const original = Buffer.from("synthetic public archive");
  const pin = createHash("sha256").update(original).digest("hex");
  verifyBytes(original, pin);
  expect(() => verifyBytes(Buffer.from("substitution"), pin)).toThrow("CI_TOOL_INTEGRITY_FAILED");
  expect(() => verifyBytes(original, "invalid")).toThrow("CI_TOOL_INTEGRITY_FAILED");
});
it("scanner evidence retains validated lower advisories and strips unknown diagnostic fields", () => {
  const report = {
    schemaVersion: 1,
    kind: "dependencies",
    status: "passed",
    ok: true,
    counts: { info: 0, low: 0, moderate: 1, high: 0, critical: 0 },
    findings: [
      {
        id: "GHSA-abcd-1234-abcd",
        package: "synthetic",
        severity: "moderate",
        raw: "private-canary",
      },
    ],
    raw: "private-canary",
  };
  const summary = projectScan(report, "dependencies");
  expect(summary.findings).toEqual([
    { id: "GHSA-abcd-1234-abcd", package: "synthetic", severity: "moderate" },
  ]);
  expect(JSON.stringify(summary).includes("private-canary")).toBe(false);
  expect(() => projectScan({ ...report, status: "failed" }, "dependencies")).toThrow();
  expect(() =>
    projectScan(
      { ...report, findings: [{ ...report.findings[0], id: "private-canary" }] },
      "dependencies",
    ),
  ).toThrow();
  expect(() =>
    projectScan(
      {
        ...report,
        counts: { ...report.counts, moderate: 0, high: 1 },
        findings: [{ ...report.findings[0], severity: "high" }],
      },
      "dependencies",
    ),
  ).toThrow();
});
it("privileged PostgreSQL provisioning refuses a developer environment", async () => {
  await expect(
    execute("bash", [join(root, "infra/ci/provision-postgres.sh")], {
      env: { ...process.env, CI: "false" },
      timeout: 5000,
    }),
  ).rejects.toMatchObject({ code: 1 });
});
it("provisioning refuses existing directories and preserves their contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-ci-tools-test-"));
  try {
    await writeFile(join(directory, "owned.txt"), "preserve");
    await expect(provisionTools(directory)).rejects.toThrow();
    expect(await readFile(join(directory, "owned.txt"), "utf8")).toBe("preserve");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("child failures export only a fixed stage, without raw diagnostics or causes", async () => {
  const canary = randomUUID();
  let caught;
  try {
    await runGate(
      "private-test",
      process.execPath,
      [
        "-e",
        "process.stdout.write(process.env.CANARY);process.stderr.write(process.env.CANARY);process.exit(1)",
      ],
      { env: { CANARY: canary } },
    );
  } catch (error) {
    caught = error;
  }
  expect(caught?.message).toBe("CI_GATE_FAILED:private-test");
  expect(caught?.cause).toBeUndefined();
  expect(JSON.stringify(caught, Object.getOwnPropertyNames(caught)).includes(canary)).toBe(false);
});

for (const kind of ["lint", "test", "scanner"]) {
  it(`an actual ${kind} CLI failure stops subsequent evidence creation`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "hambazi-ci-fail-"));
    const marker = join(directory, "must-not-exist");
    try {
      let command = process.execPath,
        args;
      if (kind === "lint") {
        await writeFile(
          join(directory, "eslint.config.mjs"),
          'export default [{ rules: { "no-unused-vars": "error" } }];',
        );
        await writeFile(join(directory, "bad.mjs"), "const unused = 1;\n");
        args = [join(root, "node_modules/eslint/bin/eslint.js"), "bad.mjs"];
      } else if (kind === "test") {
        await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
        await writeFile(
          join(directory, "bad.test.mjs"),
          'import { it, expect } from "vitest"; it("deliberate failure", () => expect(false).toBe(true));',
        );
        args = [join(root, "node_modules/vitest/vitest.mjs"), "run", "bad.test.mjs"];
      } else {
        args = [join(root, "infra/scripts/security-scan.mjs"), "secrets"];
      }
      await expect(
        runSequence([
          {
            stage: kind,
            command,
            args,
            options: {
              cwd: directory,
              env: { ...process.env, SECURITY_SCANNER_DIR: directory },
              timeout: 30000,
            },
          },
          {
            stage: "evidence",
            command: process.execPath,
            args: ["-e", 'require("node:fs").writeFileSync(process.argv[1], "unexpected")', marker],
          },
        ]),
      ).rejects.toThrow(`CI_GATE_FAILED:${kind}`);
      await expect(readFile(marker)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 40000);
}

it("missing and duplicate phase status evidence fails rather than granting readiness", () => {
  expect(() => releaseGateStates(plan.replace("### Phase 17C —", "### Removed 17C —"))).toThrow();
  expect(() =>
    releaseGateStates(plan + "\n### Phase 17C — duplicate\n- **Status:** Completed\n"),
  ).toThrow();
});

it("build evidence requires clean source and normal policy, projects scalars and refuses symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-ci-evidence-test-"));
  const repository = join(directory, "repo");
  const passed = [
    {
      stage: "synthetic",
      passed: true,
      durationMs: 0,
      tests: 1,
      browserCases: 0,
      raw: "private-report",
    },
  ];
  try {
    await mkdir(repository);
    await execute("git", ["init", "--quiet"], { cwd: repository });
    for (const path of [
      "apps/api/dist",
      "apps/bot/dist",
      "apps/worker/dist",
      "apps/web/dist/client",
      "docs/contracts",
      "packages/database/prisma",
      "infra/ci",
      "infra/security",
    ])
      await mkdir(join(repository, path), { recursive: true });
    for (const app of ["api", "bot", "worker"])
      await writeFile(join(repository, `apps/${app}/dist/index.js`), "export {};\n");
    await writeFile(
      join(repository, "apps/web/dist/client/index.html"),
      "<main>synthetic build</main>",
    );
    const assets = "apps/web/dist/client/assets";
    await mkdir(join(repository, assets));
    const media = ["svg", "png", "jpg", "jpeg", "webp", "woff2", "ttf"];
    for (const extension of media)
      await writeFile(join(repository, assets, `fixture.${extension}`), Buffer.from([0, 255, 17]));
    const policy = join(repository, "apps/web/dist/client/security-headers.json");
    await writeFile(policy, '{"profile":"production"}');
    await writeFile(join(repository, "docs/contracts/example.openapi.json"), "{}");
    await writeFile(join(repository, "docs/implementation-plan.md"), pendingPlan);
    await writeFile(join(repository, ".gitignore"), "dist/\n");
    await writeFile(join(repository, "pnpm-lock.yaml"), "synthetic lockfile");
    await writeFile(join(repository, "packages/database/prisma/schema.prisma"), "synthetic schema");
    await writeFile(join(repository, "infra/ci/toolchain.json"), "{}");
    await writeFile(join(repository, "infra/security/policy.json"), "{}");
    await execute("git", ["add", "."], { cwd: repository });
    await execute(
      "git",
      [
        "-c",
        "user.name=CI fixture",
        "-c",
        "user.email=ci@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--quiet",
        "-m",
        "Disposable evidence fixture",
      ],
      { cwd: repository },
    );
    const result = await writeEvidence(repository, join(directory, "evidence"), passed, {});
    expect(result.productionReleaseApproved).toBe(false);
    expect(result.releaseGates.find((gate) => gate.phase === "17C").status).toBe("Pending");
    expect(result.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    for (const extension of media)
      expect(result.files.find((file) => file.path === `${assets}/fixture.${extension}`)).toEqual({
        path: `${assets}/fixture.${extension}`,
        bytes: 3,
        sha256: createHash("sha256")
          .update(Buffer.from([0, 255, 17]))
          .digest("hex"),
      });
    expect(JSON.stringify(result).includes("private-report")).toBe(false);
    for (const path of [
      `${assets}/unexpected.bin`,
      "apps/web/dist/client/unexpected.png",
      "apps/api/dist/unexpected.png",
    ]) {
      await writeFile(join(repository, path), "not an approved build artifact");
      await expect(
        writeEvidence(repository, join(directory, "unapproved-asset"), passed, {}),
      ).rejects.toThrow();
      await rm(join(repository, path));
    }
    for (const scan of [
      { sourceCommit: "f".repeat(40), sourceDirty: false },
      { sourceCommit: result.commit, sourceDirty: true },
    ])
      await expect(
        writeEvidence(
          repository,
          join(directory, `unbound-image-${scan.sourceDirty}`),
          [{ ...passed[0], stage: "application-images", scan }],
          {},
        ),
      ).rejects.toThrow();
    await expect(
      writeEvidence(repository, join(directory, "wrong-ref"), passed, {
        GITHUB_SHA: "f".repeat(40),
      }),
    ).rejects.toThrow();
    await expect(
      writeEvidence(repository, join(directory, "evidence"), passed, {}),
    ).rejects.toThrow();
    await writeFile(join(repository, "dirty.txt"), "dirty");
    await expect(
      writeEvidence(repository, join(directory, "dirty-evidence"), passed, {}),
    ).rejects.toThrow();
    await rm(join(repository, "dirty.txt"));
    await writeFile(policy, '{"profile":"loopback"}');
    await expect(
      writeEvidence(repository, join(directory, "loopback-evidence"), passed, {}),
    ).rejects.toThrow();
    await writeFile(policy, '{"profile":"production"}');
    await expect(
      writeEvidence(
        repository,
        join(directory, "invalid-counts"),
        [{ ...passed[0], tests: Infinity }],
        {},
      ),
    ).rejects.toThrow();
    const publicPolicy = join(directory, "public-policy.json");
    await writeFile(publicPolicy, '{"profile":"production"}');
    await rm(policy);
    await symlink(publicPolicy, policy);
    await expect(
      writeEvidence(repository, join(directory, "symlink-evidence"), passed, {}),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);

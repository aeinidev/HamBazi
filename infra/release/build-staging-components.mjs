import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { resolve, join, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runGate } from "../ci/gates.mjs";
import { selectedComponentRoles } from "./component-provenance.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const hash = (b) => createHash("sha256").update(b).digest("hex");
const invalid = () => {
  throw new Error("STAGING_COMPONENT_BUILD_INVALID");
};
export async function buildStagingComponents(output, archives, roles) {
  const selected = selectedComponentRoles(roles);
  if (
    !isAbsolute(output) ||
    !isAbsolute(archives) ||
    !relative(root, resolve(output)).startsWith("../")
  )
    invalid();
  const source = (
    await runGate("component-source", "git", ["rev-parse", "HEAD"], { cwd: root })
  ).trim();
  if (
    !/^[a-f0-9]{40}$/.test(source) ||
    (
      await runGate("component-clean-source", "git", ["status", "--porcelain"], { cwd: root })
    ).trim()
  )
    invalid();
  const lockBytes = await readFile(join(root, "infra/docker/staging/component-lock.json"));
  const lock = JSON.parse(lockBytes);
  if (lock.schemaVersion !== 1 || lock.platform !== "linux/amd64") invalid();
  await mkdir(output, { mode: 0o700 });
  const images = [];
  for (const role of selected) {
    const context = join(output, role);
    await mkdir(context, { mode: 0o700 });
    await mkdir(join(context, "inputs"), { mode: 0o700 });
    const dockerfile = await readFile(
      join(
        root,
        "infra/docker/staging",
        role === "ingress" ? "Ingress.Dockerfile" : "Acme.Dockerfile",
      ),
    );
    const component = lock.components[role];
    if (!dockerfile.toString().startsWith("FROM " + component.base + "\n")) invalid();
    const buildInputSha256 = hash(Buffer.concat([dockerfile, lockBytes]));
    for (const pin of [...component.apkPatches, ...component.wheels]) {
      if (
        !/^[A-Za-z0-9._-]+$/.test(pin.filename) ||
        !/^https:\/\//.test(pin.archiveUrl) ||
        !/^[a-f0-9]{64}$/.test(pin.sha256)
      )
        invalid();
      const path = join(archives, role, pin.filename);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) invalid();
      const bytes = await readFile(path);
      if (hash(bytes) !== pin.sha256) invalid();
      await writeFile(join(context, "inputs", pin.filename), bytes, { mode: 0o600, flag: "wx" });
    }
    await writeFile(join(context, "Dockerfile"), dockerfile, { mode: 0o600, flag: "wx" });
    const tag = `hambazi-staging/${role}:${source}-${buildInputSha256.slice(0, 16)}`;
    await runGate(
      "component-build-" + role,
      "docker",
      [
        "build",
        "--platform",
        "linux/amd64",
        "--network",
        "none",
        "--pull=false",
        "--tag",
        tag,
        "--build-arg",
        "SOURCE_COMMIT=" + source,
        "--build-arg",
        "BUILD_INPUT=" + buildInputSha256,
        context,
      ],
      { timeout: 300000 },
    );
    const identity = JSON.parse(
      await runGate("component-inspect-" + role, "docker", ["image", "inspect", tag]),
    )[0];
    if (
      !/^sha256:[a-f0-9]{64}$/.test(identity.Id) ||
      identity.Os !== "linux" ||
      identity.Architecture !== "amd64" ||
      identity.Config.Labels["org.opencontainers.image.revision"] !== source ||
      identity.Config.Labels["io.hambazi.component-input-sha256"] !== buildInputSha256
    )
      invalid();
    images.push({ role, image: tag + "@" + identity.Id, buildInputSha256, sourceCommit: source });
  }
  const result = {
    schemaVersion: 1,
    purpose: "temporary-staging-components",
    sourceCommit: source,
    sourceDirty: false,
    platform: "linux/amd64",
    productionReleaseApproved: false,
    lockSha256: hash(lockBytes),
    images,
  };
  await writeFile(join(output, "images.json"), JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (![4, 5].includes(process.argv.length)) invalid();
    const result = await buildStagingComponents(
      resolve(process.argv[2]),
      resolve(process.argv[3]),
      process.argv[4] ? [process.argv[4]] : undefined,
    );
    console.info(JSON.stringify(result));
  } catch {
    console.error("STAGING_COMPONENT_BUILD_FAILED");
    process.exitCode = 1;
  }
}

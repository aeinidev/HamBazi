import { createHash } from "node:crypto";
import { mkdir, readFile, lstat, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotCandidate } from "../scripts/security-scan.mjs";
import { runGate } from "../ci/gates.mjs";
import { createBrowserPolicy } from "../../apps/web/security/browser-policy.ts";
import { telegramSdkIntegrity } from "../../apps/web/src/platform/telegram-sdk.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const roles = Object.freeze(["api", "bot", "worker", "web"]);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const invalid = () => {
  throw new Error("PACKAGING_INPUT_INVALID");
};

export function verifyArchive(data, expected) {
  if (
    data.length < 1 ||
    data.length > 8 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(expected) ||
    hash(data) !== expected
  )
    invalid();
}

export const buildIdentity = (sourceSnapshotSha256, browserPolicy) =>
  hash(JSON.stringify({ sourceSnapshotSha256, browserPolicy }));

export async function hashContext(directory) {
  const files = [];
  async function visit(path = "") {
    const info = await lstat(join(directory, path));
    if (info.isSymbolicLink()) invalid();
    if (info.isDirectory()) {
      for (const name of (await readdir(join(directory, path))).sort())
        await visit(path ? `${path}/${name}` : name);
    } else {
      if (!info.isFile() || info.size > 64 * 1024 * 1024 || files.length >= 5000) invalid();
      files.push({ path, bytes: info.size, sha256: hash(await readFile(join(directory, path))) });
    }
  }
  await visit();
  return { sha256: hash(JSON.stringify(files)), files };
}

/** Local candidates only. Publication/deployment and production readiness are never granted. */
export async function buildCandidates(directory, environment = process.env) {
  if (!isAbsolute(directory ?? "")) invalid();
  directory = resolve(directory);
  if (!isAbsolute(directory) || !relative(root, directory).startsWith("../")) invalid();
  const policy = createBrowserPolicy(
    {
      profile: "production",
      webOrigin: environment.HAMBAZI_WEB_ORIGIN || null,
      apiOrigin: environment.VITE_API_ORIGIN || null,
      frameAncestors: JSON.parse(environment.HAMBAZI_WEB_FRAME_ANCESTORS ?? "[]"),
    },
    telegramSdkIntegrity,
  );
  if (
    environment.HAMBAZI_WEB_POLICY_PROFILE &&
    environment.HAMBAZI_WEB_POLICY_PROFILE !== "production"
  )
    invalid();
  if (process.versions.node !== "24.20.0") invalid();
  if ((await runGate("packaging-pnpm", "pnpm", ["--version"])).trim() !== "12.4.1") invalid();
  const commit = (
    await runGate("packaging-source", "git", ["rev-parse", "HEAD"], { cwd: root })
  ).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) invalid();
  const dirty =
    (await runGate("packaging-status", "git", ["status", "--porcelain"], { cwd: root })).trim()
      .length > 0;
  await mkdir(directory, { mode: 0o700 });
  const context = join(directory, "context");
  await mkdir(context, { mode: 0o700 });
  let complete = false;
  try {
    await snapshotCandidate(context);
    const source = await hashContext(context);
    const buildInputSha256 = buildIdentity(source.sha256, policy);
    const baseLock = JSON.parse(
      await readFile(join(context, "infra/docker/apps/base-lock.json"), "utf8"),
    );
    const dockerfile = await readFile(join(context, "infra/docker/apps/Dockerfile"), "utf8");
    if (
      baseLock.schemaVersion !== 1 ||
      baseLock.platform !== "linux/amd64" ||
      dockerfile
        .split("\n")
        .filter((line) => line.startsWith("FROM node:"))
        .some((line) => !line.startsWith(`FROM ${baseLock.image} AS `))
    )
      invalid();
    const inputs = join(context, ".build-inputs");
    await mkdir(inputs, { mode: 0o700 });
    for (const [index, name] of ["libcrypto3", "libssl3"].entries()) {
      const pin = baseLock.packages?.[index];
      if (
        pin?.package !== name ||
        pin.version !== "3.5.9-r0" ||
        pin.archiveUrl !==
          `https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/${name}-${pin.version}.apk`
      )
        invalid();
      let data;
      if (environment.HAMBAZI_APP_ARCHIVE_DIR) {
        const path = join(environment.HAMBAZI_APP_ARCHIVE_DIR, `${name}.apk`);
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) invalid();
        data = await readFile(path);
      } else {
        const response = await fetch(pin.archiveUrl, {
          signal: AbortSignal.timeout(60000),
          redirect: "error",
        });
        if (!response.ok || Number(response.headers.get("content-length")) > 8 * 1024 * 1024)
          invalid();
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) invalid();
          chunks.push(chunk);
        }
        data = Buffer.concat(chunks);
      }
      verifyArchive(data, pin.archiveSha256);
      await writeFile(join(inputs, `${name}.apk`), data, { flag: "wx", mode: 0o600 });
    }
    const images = [];
    const safeEnvironment = Object.fromEntries(
      [
        "PATH",
        "HOME",
        "TMPDIR",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
      ]
        .filter((key) => environment[key] !== undefined)
        .map((key) => [key, environment[key]]),
    );
    for (const role of roles) {
      const tag = `hambazi-candidate/${role}:${commit}-${buildInputSha256.slice(0, 16)}`;
      const metadata = join(directory, `${role}.build.json`);
      await runGate(
        `packaging-${role}`,
        "docker",
        [
          "buildx",
          "build",
          "--platform=linux/amd64",
          "--file",
          join(context, "infra/docker/apps/Dockerfile"),
          "--target",
          role,
          "--provenance=false",
          "--sbom=false",
          "--metadata-file",
          metadata,
          "--build-arg",
          `SOURCE_COMMIT=${commit}`,
          "--build-arg",
          `SOURCE_SNAPSHOT=${source.sha256}`,
          "--build-arg",
          `BUILD_INPUT=${buildInputSha256}`,
          "--build-arg",
          `VITE_API_ORIGIN=${policy.apiOrigin ?? ""}`,
          "--build-arg",
          `HAMBAZI_WEB_ORIGIN=${policy.webOrigin ?? ""}`,
          "--build-arg",
          `HAMBAZI_WEB_FRAME_ANCESTORS=${JSON.stringify(policy.frameAncestors)}`,
          "--output",
          `type=image,name=${tag},push=false,unpack=false`,
          context,
        ],
        { cwd: directory, env: safeEnvironment, timeout: 900000 },
      );
      const raw = JSON.parse(await readFile(metadata, "utf8"));
      const digest = raw["containerimage.digest"];
      if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? "")) invalid();
      const image = `${tag}@${digest}`;
      const config = JSON.parse(
        await runGate(`packaging-inspect-${role}`, "docker", ["image", "inspect", image], {
          env: safeEnvironment,
        }),
      )[0]?.Config;
      if (
        config?.User !== "1000:1000" ||
        config?.Entrypoint?.[0] !== "node" ||
        config?.Labels?.["io.hambazi.source-snapshot-sha256"] !== source.sha256 ||
        config?.Labels?.["io.hambazi.build-input-sha256"] !== buildInputSha256
      )
        invalid();
      images.push({ role, image });
      await rm(metadata);
      console.info(`Packaging candidate built: ${role}`);
    }
    const manifest = {
      schemaVersion: 1,
      purpose: "local-packaging-candidate",
      productionReleaseApproved: false,
      platform: "linux/amd64",
      sourceCommit: commit,
      sourceDirty: dirty,
      sourceSnapshotSha256: source.sha256,
      buildInputSha256,
      lockfileSha256: hash(await readFile(join(context, "pnpm-lock.yaml"))),
      dockerfileSha256: hash(await readFile(join(context, "infra/docker/apps/Dockerfile"))),
      baseLockSha256: hash(await readFile(join(context, "infra/docker/apps/base-lock.json"))),
      browserPolicy: policy,
      images,
    };
    await writeFile(join(directory, "images.json"), JSON.stringify(manifest, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    complete = true;
    return manifest;
  } finally {
    await rm(context, { recursive: true, force: true });
    if (!complete)
      for (const role of roles) await rm(join(directory, `${role}.build.json`), { force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2] || process.argv.length !== 3) invalid();
    await buildCandidates(process.argv[2]);
    console.info("Portable candidate inventory written; deployment is not authorized.");
  } catch (error) {
    const stage = /^CI_GATE_FAILED:packaging-[a-z-]+$/.test(error?.message ?? "")
      ? error.message
      : "PACKAGING_FAILED";
    console.error(stage);
    process.exitCode = 1;
  }
}

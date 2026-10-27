import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const lock = JSON.parse(
  await readFile(new URL("../docker/postgres/image-lock.json", import.meta.url), "utf8"),
);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const directory = await mkdtemp(join(tmpdir(), "hambazi-postgres-build-"));
let stage = "inputs";
try {
  const dockerfile = await readFile(new URL("../docker/postgres/Dockerfile", import.meta.url));
  if (
    lock.schemaVersion !== 1 ||
    lock.platform !== "linux/amd64" ||
    !/^hambazi-local\/postgres:[a-zA-Z0-9_.-]+$/.test(lock.tag) ||
    !lock.image.startsWith(lock.tag + "@") ||
    !/^sha256:[a-f0-9]{64}$/.test(lock.image.split("@")[1]) ||
    !Number.isSafeInteger(lock.sourceDateEpoch) ||
    !dockerfile.toString().includes(`FROM ${lock.baseImage}\n`) ||
    hash(dockerfile) !== lock.dockerfileSha256
  )
    throw new Error("Invalid build inputs");
  await writeFile(join(directory, "Dockerfile"), dockerfile, { mode: 0o600 });
  for (const [name, artifact, override, label] of [
    ["su-exec.apk", lock.helper, process.env.HAMBAZI_POSTGRES_HELPER_ARCHIVE, "helper"],
    ["nghttp2-libs.apk", lock.http2, process.env.HAMBAZI_POSTGRES_HTTP2_ARCHIVE, "http2"],
    ["brotli-libs.apk", lock.brotli, undefined, "brotli"],
    ["libcurl.apk", lock.curl, undefined, "libcurl"],
  ]) {
    stage = label + "-integrity";
    if (
      !/^https:\/\/dl-cdn\.alpinelinux\.org\/alpine\/v3\.24\/main\/x86_64\/(su-exec|nghttp2-libs|brotli-libs|libcurl)-[\w.-]+\.apk$/.test(
        artifact.archiveUrl,
      )
    )
      throw new Error();
    let archive;
    if (override) {
      const info = await lstat(override);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) throw new Error();
      archive = await readFile(override);
    } else {
      const response = await fetch(artifact.archiveUrl, { signal: AbortSignal.timeout(60000) });
      if (!response.ok || !response.body) throw new Error();
      const parts = [];
      let size = 0;
      for await (const part of response.body) {
        size += part.length;
        if (size > 1048576) throw new Error();
        parts.push(part);
      }
      archive = Buffer.concat(parts);
    }
    if (hash(archive) !== artifact.archiveSha256) throw new Error();
    await writeFile(join(directory, name), archive, { mode: 0o600 });
  }
  const env = Object.fromEntries(
    ["PATH", "HOME"].filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]),
  );
  stage = "build";
  await run(
    "docker",
    [
      "build",
      "--no-cache",
      "--network=none",
      "--platform",
      lock.platform,
      "--provenance=false",
      "--build-arg",
      `SOURCE_DATE_EPOCH=${lock.sourceDateEpoch}`,
      "--output",
      `type=image,name=${lock.tag},push=false,rewrite-timestamp=true,unpack=false`,
      "--file",
      join(directory, "Dockerfile"),
      "--iidfile",
      join(directory, "image-id"),
      directory,
    ],
    { env, timeout: 180000, killSignal: "SIGKILL", maxBuffer: 8388608 },
  );
  stage = "output-integrity";
  const imageId = (await readFile(join(directory, "image-id"), "utf8")).trim();
  if (imageId !== lock.image.split("@")[1]) throw new Error();
  const inspected = await run(
    "docker",
    ["image", "inspect", lock.image, "--format", "{{.Os}}/{{.Architecture}}"],
    { env, timeout: 10000 },
  );
  if (inspected.stdout.trim() !== lock.platform) throw new Error();
  console.info(
    "Built and verified the pinned local PostgreSQL image; no registry publication or service startup.",
  );
} catch {
  console.error(`LOCAL_POSTGRES_BUILD_FAILED at ${stage}; no raw diagnostics are printed.`);
  process.exitCode = 1;
} finally {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch {
    console.error("LOCAL_POSTGRES_BUILD_FAILED at cleanup; no raw diagnostics are printed.");
    process.exitCode = 1;
  }
}

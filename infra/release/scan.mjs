import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { verifyTool, assessImage, assertFreshDatabase } from "../scripts/security-scan.mjs";
import { runGate } from "../ci/gates.mjs";

const invalid = () => {
  throw new Error("APPLICATION_SCAN_INVALID");
};
export async function scanApplications(
  manifestPath,
  scannerDirectory = process.env.SECURITY_SCANNER_DIR,
) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.purpose !== "local-packaging-candidate" ||
    manifest.productionReleaseApproved !== false ||
    manifest.platform !== "linux/amd64" ||
    !/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? "") ||
    typeof manifest.sourceDirty !== "boolean" ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceSnapshotSha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(manifest.buildInputSha256 ?? "") ||
    !Array.isArray(manifest.images) ||
    manifest.images.length !== 4
  )
    invalid();
  if (!scannerDirectory || process.platform !== "linux" || process.arch !== "x64") invalid();
  const executable = resolve(scannerDirectory, "trivy");
  await verifyTool(executable, "trivy");
  const cache = resolve(scannerDirectory, "cache");
  const info = await lstat(cache);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) invalid();
  const environment = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NO_PROXY",
      "http_proxy",
      "https_proxy",
      "no_proxy",
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  const directory = await mkdtemp(join(tmpdir(), "hambazi-app-scan-"));
  try {
    await runGate(
      "application-scan-database",
      executable,
      ["image", "--download-db-only", "--cache-dir", cache, "--quiet"],
      { cwd: directory, env: environment, timeout: 180000 },
    );
    const database = assertFreshDatabase(
      JSON.parse(await readFile(join(cache, "db/metadata.json"), "utf8")),
    );
    const images = [];
    for (const [index, role] of ["api", "bot", "worker", "web"].entries()) {
      const entry = manifest.images[index];
      if (
        entry.role !== role ||
        !new RegExp(
          `^hambazi-candidate/${role}:[a-f0-9]{40}-[a-f0-9]{16}@sha256:[a-f0-9]{64}$`,
        ).test(entry.image ?? "")
      )
        invalid();
      const config = JSON.parse(
        await runGate("application-scan-identity", "docker", ["image", "inspect", entry.image], {
          env: environment,
        }),
      )[0]?.Config;
      if (
        config?.User !== "1000:1000" ||
        config.Labels?.["io.hambazi.source-snapshot-sha256"] !== manifest.sourceSnapshotSha256 ||
        config.Labels?.["io.hambazi.build-input-sha256"] !== manifest.buildInputSha256 ||
        config.Labels?.["org.opencontainers.image.revision"] !== manifest.sourceCommit
      )
        invalid();
      const output = join(directory, "report.json");
      await runGate(
        `application-scan-${role}`,
        executable,
        [
          "image",
          "--scanners=vuln",
          "--image-src=docker",
          "--format=json",
          "--output",
          output,
          "--exit-code=0",
          "--cache-dir",
          cache,
          "--quiet",
          entry.image,
        ],
        { cwd: directory, env: environment, timeout: 180000 },
      );
      if ((await lstat(output)).size > 64 * 1024 * 1024) invalid();
      images.push({
        role,
        ...assessImage(JSON.parse(await readFile(output, "utf8")), entry.image),
      });
    }
    return {
      schemaVersion: 1,
      kind: "application-images",
      ok: images.every((image) => image.ok),
      status: images.every((image) => image.ok) ? "passed" : "blocked",
      database,
      sourceCommit: manifest.sourceCommit,
      sourceDirty: manifest.sourceDirty,
      sourceSnapshotSha256: manifest.sourceSnapshotSha256,
      buildInputSha256: manifest.buildInputSha256,
      images,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) invalid();
    const result = await scanApplications(resolve(process.argv[2]));
    // Only allowlisted image pins, public advisories and numeric evidence leave the scanner.
    await writeFile(
      resolve(process.argv[2] + ".scan.json"),
      JSON.stringify(result, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    console.info(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error("APPLICATION_IMAGE_SCAN_FAILED");
    process.exitCode = 1;
  }
}

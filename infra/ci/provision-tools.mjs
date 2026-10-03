import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../../", import.meta.url));
const execute = promisify(execFile);
const policy = JSON.parse(await readFile(join(root, "infra/security/policy.json"), "utf8"));
const toolchain = JSON.parse(await readFile(join(root, "infra/ci/toolchain.json"), "utf8"));
const hash = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);

export function verifyBytes(bytes, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected) || hash(bytes) !== expected)
    throw new Error("CI_TOOL_INTEGRITY_FAILED");
}
async function download(url, limit) {
  if (!url.startsWith("https://")) throw new Error("CI_TOOL_DOWNLOAD_FAILED");
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body) throw new Error("CI_TOOL_DOWNLOAD_FAILED");
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > limit) throw new Error("CI_TOOL_DOWNLOAD_FAILED");
    parts.push(part);
  }
  return Buffer.concat(parts);
}
async function provisioned(name, limit) {
  const path = join(process.env.HAMBAZI_CI_ARCHIVE_DIR, name);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit)
    throw new Error("CI_TOOL_INTEGRITY_FAILED");
  return readFile(path);
}

export async function provisionTools(target) {
  if (process.platform !== "linux" || process.arch !== "x64" || !isAbsolute(target ?? ""))
    throw new Error("CI_TOOLS_REQUIRE_PRIVATE_LINUX_X64_DIRECTORY");
  // Refuse existing targets; never erase or replace an independently supplied directory.
  await mkdir(target, { mode: 0o700 });
  const directory = await mkdtemp(join(tmpdir(), "hambazi-ci-download-"));
  try {
    for (const [name, pin] of Object.entries({
      ...policy.tools,
      actionlint: toolchain.actionlint,
    })) {
      const archiveName = new URL(pin.archiveUrl).pathname.split("/").at(-1);
      const bytes = process.env.HAMBAZI_CI_ARCHIVE_DIR
        ? await provisioned(archiveName, 256 * 1024 * 1024)
        : await download(pin.archiveUrl, 256 * 1024 * 1024);
      verifyBytes(bytes, pin.archiveSha256);
      const archive = join(directory, "tool.tar.gz");
      await writeFile(archive, bytes, { mode: 0o600 });
      await execute(
        "tar",
        ["-xzf", archive, "--no-same-owner", "--no-same-permissions", "-C", directory, name],
        {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        },
      );
      const executable = join(directory, name);
      const info = await lstat(executable);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("CI_TOOL_INTEGRITY_FAILED");
      verifyBytes(await readFile(executable), pin.binarySha256);
      await chmod(executable, 0o700);
      await rename(executable, join(target, name));
    }
    const sdk = process.env.HAMBAZI_CI_ARCHIVE_DIR
      ? await provisioned("telegram-web-app.js", 1024 * 1024)
      : await download(toolchain.telegramSdk.url, 1024 * 1024);
    if (`sha384-${hash(sdk, "sha384", "base64")}` !== toolchain.telegramSdk.integrity)
      throw new Error("CI_SDK_INTEGRITY_FAILED");
    await writeFile(join(target, "telegram-web-app.js"), sdk, { mode: 0o600 });
  } catch {
    await rm(target, { recursive: true, force: true });
    throw new Error("CI_TOOL_PROVISIONING_FAILED");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await provisionTools(process.env.SECURITY_SCANNER_DIR);
    console.info("Verified pinned scanner, actionlint and official SDK bytes.");
  } catch {
    console.error("CI_TOOL_PROVISIONING_FAILED; raw download/archive diagnostics are suppressed.");
    process.exitCode = 1;
  }
}

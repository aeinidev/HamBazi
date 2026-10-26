import { constants } from "node:fs";
import { lstat, open, rename, unlink, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { ReadStream, WriteStream } from "node:tty";
import { StringDecoder } from "node:string_decoder";

export const stagingOwnerProfile = "staging-ssh-root-v1";
export function assertStagingOperator(input: {
  uid: number | undefined;
  realm: string;
  environment: string;
  profile: string;
  sshConnection: string | undefined;
  sshTty: string | undefined;
  actualTty: string;
  terminal: boolean;
  debugging: boolean;
  acknowledged: boolean;
}) {
  const peer = input.sshConnection?.split(" ") ?? [];
  if (
    input.uid !== 0 ||
    input.realm !== "staging" ||
    input.environment !== "staging" ||
    input.profile !== stagingOwnerProfile ||
    !input.terminal ||
    input.debugging ||
    !input.acknowledged ||
    !input.sshTty?.startsWith("/dev/pts/") ||
    input.sshTty !== input.actualTty ||
    peer.length !== 4 ||
    !isIP(peer[0]!) ||
    !isIP(peer[2]!) ||
    !peer
      .filter((_, i) => i === 1 || i === 3)
      .every((port) => /^[0-9]{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535)
  )
    throw new Error("ADMIN_PRIVATE_OPERATOR_REQUIRED");
}

export async function privateDirectory(path: string) {
  if (!path.startsWith("/") || resolve(path) !== path)
    throw new Error("ADMIN_PRIVATE_PATH_REQUIRED");
  for (let parent = path; ; parent = dirname(parent)) {
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022) !== 0)
      throw new Error("ADMIN_PRIVATE_PATH_REQUIRED");
    if (parent === "/") break;
  }
}
export async function readPrivate(path: string, maxBytes = 65536) {
  if (!path.startsWith("/") || resolve(path) !== path)
    throw new Error("ADMIN_PRIVATE_PATH_REQUIRED");
  await privateDirectory(dirname(path));
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.uid !== 0 ||
      info.nlink !== 1 ||
      (info.mode & 0o077) !== 0 ||
      info.size > maxBytes
    )
      throw new Error("ADMIN_PRIVATE_FILE_REQUIRED");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
export function parsePrivateEnvironment(value: string) {
  const result: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    if (line === "" || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    const name = line.slice(0, at);
    if (at < 1 || !/^[A-Z][A-Z0-9_]*$/.test(name) || name in result)
      throw new Error("ADMIN_PRIVATE_ENV_INVALID");
    // Raw environment format: no shell evaluation, expansion or source command.
    result[name] = line.slice(at + 1);
  }
  return result;
}

/** No echo, masking, history, completion, secret arguments, or credential files. */
export async function hiddenLine(input: ReadStream, output: WriteStream, label: string) {
  if (!input.isTTY || !output.isTTY || input.isRaw) throw new Error("ADMIN_PRIVATE_TTY_REQUIRED");
  input.setRawMode(true);
  try {
    // Switch echo off before the prompt becomes visible, including fast paste.
    output.write(label + ": ");
    input.resume();
    return await new Promise<string>((resolveLine, reject) => {
      let value = "";
      let settled = false;
      const decoder = new StringDecoder("utf8");
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        input.off("data", data);
        input.off("end", ended);
        input.off("error", failed);
        for (const name of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(name, ended);
        output.write("\n");
        if (error) {
          value = "";
          reject(error);
        } else resolveLine(value);
      };
      const ended = () => finish(new Error("ADMIN_PRIVATE_INPUT_CANCELLED"));
      const failed = () => finish(new Error("ADMIN_PRIVATE_INPUT_FAILED"));
      const data = (chunk: Buffer) => {
        const text = decoder.write(chunk);
        if (text.includes("\ufffd")) return failed();
        for (let i = 0; i < text.length; i++) {
          const char = text[i]!;
          if (char === "\r" || char === "\n") {
            if (
              text
                .slice(i + 1)
                .replaceAll("\r", "")
                .replaceAll("\n", "") !== ""
            )
              return finish(new Error("ADMIN_PRIVATE_MULTILINE_REJECTED"));
            return finish();
          }
          if (char === "\u0003" || char === "\u0004" || char === "\u001b") return ended();
          if (char === "\u007f" || char === "\b") {
            value = value.slice(0, -1);
            continue;
          }
          if (char.charCodeAt(0) < 32 || value.length >= 256) return failed();
          value += char;
        }
      };
      const timeout = setTimeout(ended, 180000);
      for (const name of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(name, ended);
      input.on("data", data);
      input.once("end", ended);
      input.once("error", failed);
    });
  } finally {
    input.setRawMode(false);
    input.pause();
  }
}

export async function actualTerminal() {
  return realpath("/proc/self/fd/0");
}

export function operatorDebugging(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  arguments_: readonly string[] = process.execArgv,
) {
  return (
    [
      "NODE_OPTIONS",
      "NODE_DEBUG",
      "NODE_DEBUG_NATIVE",
      "NODE_V8_COVERAGE",
      "NODE_REDIRECT_WARNINGS",
      "NODE_DIAGNOSTIC_DIR",
      "SSLKEYLOGFILE",
      "LD_PRELOAD",
      "LD_AUDIT",
    ].some((key) => !!environment[key]) || arguments_.length !== 0
  );
}

export async function requireCeremonySafety(now = Date.now()) {
  for (const path of [
    "/opt/hambazi/security/state.json",
    "/opt/hambazi/admin/security/state.json",
  ]) {
    const state = JSON.parse((await readPrivate(path)).toString()) as { deadlineUTC?: unknown };
    const deadline = typeof state.deadlineUTC === "string" ? Date.parse(state.deadlineUTC) : NaN;
    if (!Number.isFinite(deadline) || deadline <= now + 300000)
      throw new Error("ADMIN_SECURITY_EVIDENCE_REQUIRED");
  }
  try {
    await lstat("/var/www/hambazi-admin/maintenance");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error("ADMIN_CONTAINMENT_ACTIVE");
}

export async function writePrivateJson(path: string, data: unknown) {
  await privateDirectory(dirname(path));
  const temporary = path + "." + randomUUID() + ".next";
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(JSON.stringify(data) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function lockPrivate(path: string) {
  await privateDirectory(dirname(path));
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  await handle.sync();
  return async () => {
    await handle.close();
    await unlink(path);
  };
}

export async function appendCeremonyAudit(
  path: string,
  record: {
    commandId: string;
    action: "bootstrap" | "recover";
    outcome: "STARTED" | "SUCCEEDED" | "DENIED";
  },
) {
  if (
    !/^[0-9a-f-]{36}$/i.test(record.commandId) ||
    !["bootstrap", "recover"].includes(record.action) ||
    !["STARTED", "SUCCEEDED", "DENIED"].includes(record.outcome)
  )
    throw new Error("ADMIN_PRIVATE_AUDIT_INVALID");
  await privateDirectory(dirname(path));
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.uid !== 0 ||
      info.nlink !== 1 ||
      (info.mode & 0o077) !== 0 ||
      info.size > 5 * 1024 * 1024
    )
      throw new Error("ADMIN_PRIVATE_AUDIT_INVALID");
    await handle.writeFile(
      JSON.stringify({
        schemaVersion: 1,
        profile: stagingOwnerProfile,
        realm: "staging",
        commandId: record.commandId,
        action: record.action,
        outcome: record.outcome,
        at: new Date().toISOString(),
      }) + "\n",
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
}

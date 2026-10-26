import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { hiddenLine, operatorDebugging } from "./admin-owner-private.js";
import { openOwnerBackup } from "./admin-owner-backup.js";
import { rehearseOwnerRestore } from "./admin-owner-restore.js";

try {
  const [path, flag, ...rest] = process.argv.slice(2);
  // This rehearsal belongs on the operator's offline copy, not an SSH session
  // attached to the application server. It cannot restore any existing DB.
  if (
    !path?.startsWith("/") ||
    resolve(path) !== path ||
    flag !== "--confirm-owned-offline-restore" ||
    rest.length ||
    process.env.SSH_CONNECTION ||
    operatorDebugging() ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    !process.stderr.isTTY
  )
    throw new Error();
  if (!/^Max core file size\s+0\s+/m.test(await readFile("/proc/self/limits", "utf8")))
    throw new Error();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let encrypted: Buffer;
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      (info.mode & 0o077) !== 0 ||
      info.uid !== process.getuid?.() ||
      info.size > 64 * 1024 * 1024 + 52
    )
      throw new Error();
    encrypted = await handle.readFile();
  } finally {
    await handle.close();
  }
  const passphrase = await hiddenLine(process.stdin, process.stdout, "عبارت رمزگذاری Backup");
  const capsule = openOwnerBackup(encrypted, passphrase);
  if (
    (await hiddenLine(
      process.stdin,
      process.stdout,
      "کپی خارج از سرور است؛ برای تأیید RESTORE OFFLINE STAGING COPY را وارد کنید",
    )) !== "RESTORE OFFLINE STAGING COPY"
  )
    throw new Error();
  await rehearseOwnerRestore(capsule);
  const receipt = {
    schemaVersion: 1,
    profile: "staging-ssh-root-v1",
    realm: "staging",
    snapshotSHA256: createHash("sha256").update(encrypted).digest("hex"),
    sourceRevision: capsule.sourceRevision,
    restored: true,
    offServerCopyVerified: true,
    checkedAtUTC: new Date().toISOString(),
  };
  const output = await open(
    path + ".restore.json",
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await output.writeFile(JSON.stringify(receipt) + "\n");
    await output.sync();
  } finally {
    await output.close();
  }
  process.stdout.write("ADMIN_OFFLINE_RESTORE_REHEARSAL_PASSED\n" + path + ".restore.json\n");
} catch {
  process.stderr.write("ADMIN_OFFLINE_RESTORE_REHEARSAL_DENIED\n");
  process.exitCode = 1;
}

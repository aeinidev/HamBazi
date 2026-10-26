import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { open, readFile, lstat, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { constants } from "node:fs";
import { promisify } from "node:util";
import { parseAdminConfig } from "@hambazi/config";
import {
  actualTerminal,
  assertStagingOperator,
  hiddenLine,
  parsePrivateEnvironment,
  privateDirectory,
  readPrivate,
  lockPrivate,
  operatorDebugging,
} from "./admin-owner-private.js";
import {
  ownerStateSchema,
  stagingOwnerPolicySchema,
  operatorDatabaseUrl,
} from "./admin-owner-state.js";
import { openOwnerBackup, ownerDumpArguments, sealOwnerBackup } from "./admin-owner-backup.js";

const root = "/opt/hambazi/admin/private";
let unlock: (() => Promise<void>) | undefined;
try {
  if (process.argv.length !== 3 || process.argv[2] !== "--confirm-private-owner-backup")
    throw new Error();
  const policy = stagingOwnerPolicySchema.parse(
    JSON.parse((await readPrivate(root + "/staging-owner-policy.json")).toString()),
  );
  assertStagingOperator({
    uid: process.getuid?.(),
    realm: policy.realm,
    environment: policy.environment,
    profile: policy.profile,
    sshConnection: process.env.SSH_CONNECTION,
    sshTty: process.env.SSH_TTY,
    actualTty: await actualTerminal(),
    terminal: !!(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY),
    debugging: operatorDebugging(),
    acknowledged: true,
  });
  if (!/^Max core file size\s+0\s+/m.test(await readFile("/proc/self/limits", "utf8")))
    throw new Error();
  unlock = await lockPrivate(root + "/owner-ceremony.lock");
  const environment = (await readPrivate(root + "/runtime.env")).toString();
  const operatorEnvironment = (await readPrivate(root + "/operator-database.env")).toString();
  const base = parsePrivateEnvironment(environment);
  const config = parseAdminConfig({
    ...base,
    ADMIN_DATABASE_URL: operatorDatabaseUrl(
      parsePrivateEnvironment(operatorEnvironment).ADMIN_RECOVERY_DATABASE_URL,
      policy,
    ),
    NODE_ENV: "production",
  });
  if (!config || config.realmId !== "staging" || config.environment !== "staging")
    throw new Error();
  const uri = new URL(config.databaseUrl.reveal());
  if (
    uri.username !== "hambazi_admin_recovery" ||
    uri.searchParams.get("sslmode") !== "verify-full"
  )
    throw new Error();
  const ca = uri.searchParams.get("sslrootcert");
  if (!ca?.startsWith("/")) throw new Error();
  // Require a private root-owned CA path, without treating its public certificate as a secret.
  await privateDirectory(ca.slice(0, ca.lastIndexOf("/")));
  const caInfo = await lstat(ca);
  if (
    !caInfo.isFile() ||
    caInfo.isSymbolicLink() ||
    caInfo.uid !== 0 ||
    (caInfo.mode & 0o022) !== 0
  )
    throw new Error();
  await privateDirectory("/usr/bin");
  const binary = await realpath("/usr/bin/pg_dump");
  await privateDirectory(dirname(binary));
  const dumpInfo = await lstat(binary);
  if (!dumpInfo.isFile() || dumpInfo.uid !== 0 || (dumpInfo.mode & 0o022) !== 0) throw new Error();
  const passphrase = await hiddenLine(
    process.stdin,
    process.stdout,
    "عبارت رمزگذاری مستقل Backup، حداقل ۲۰ نویسه",
  );
  if (
    passphrase.length < 20 ||
    (await hiddenLine(process.stdin, process.stdout, "تکرار عبارت Backup")) !== passphrase
  )
    throw new Error();
  if (
    (await hiddenLine(
      process.stdin,
      process.stdout,
      "برای تأیید عبارت BACKUP OWNER STAGING را وارد کنید",
    )) !== "BACKUP OWNER STAGING"
  )
    throw new Error();
  let checkpoint: ReturnType<typeof ownerStateSchema.parse> | null = null;
  try {
    checkpoint = ownerStateSchema.parse(
      JSON.parse((await readPrivate(root + "/owner-checkpoint.json")).toString()),
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (checkpoint?.pending) throw new Error();
  const dump = await promisify(execFile)("/usr/bin/pg_dump", ownerDumpArguments, {
    encoding: "buffer",
    timeout: 60000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C.UTF-8",
      PGHOST: uri.hostname,
      PGPORT: uri.port || "5432",
      PGDATABASE: decodeURIComponent(uri.pathname.slice(1)),
      PGUSER: decodeURIComponent(uri.username),
      PGPASSWORD: decodeURIComponent(uri.password),
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT: ca,
      PGCONNECT_TIMEOUT: "5",
    },
  });
  if (!dump.stdout.subarray(0, 5).equals(Buffer.from("PGDMP"))) throw new Error();
  if (
    (await readPrivate(root + "/runtime.env")).toString() !== environment ||
    (await readPrivate(root + "/operator-database.env")).toString() !== operatorEnvironment
  )
    throw new Error();
  const encrypted = sealOwnerBackup(
    {
      schemaVersion: 1,
      scope: "staging-admin-six-tables",
      realm: "staging",
      createdAtUTC: new Date().toISOString(),
      sourceRevision: policy.sourceRevision,
      schemaTag: "admin-local-identity+password-rotation-v1",
      runtimeEnvironment: environment,
      operatorEnvironment,
      checkpoint,
      dumpBase64: dump.stdout.toString("base64"),
    },
    passphrase,
  );
  // Verify AEAD/format before committing the encrypted file. Plaintext stays in process memory.
  openOwnerBackup(encrypted, passphrase);
  dump.stdout.fill(0);
  const directory = "/opt/hambazi/admin/backups";
  await privateDirectory(directory);
  const path = directory + "/owner-" + randomUUID() + ".hba";
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(encrypted);
    await handle.sync();
  } finally {
    await handle.close();
  }
  process.stdout.write(
    "ADMIN_STAGING_OWNER_BACKUP_CREATED\n" +
      path +
      "\nSHA256 " +
      createHash("sha256").update(encrypted).digest("hex") +
      "\n",
  );
} catch {
  process.stderr.write("ADMIN_STAGING_OWNER_BACKUP_DENIED\n");
  process.exitCode = 1;
} finally {
  await unlock?.().catch(() => {
    process.exitCode = 1;
  });
}

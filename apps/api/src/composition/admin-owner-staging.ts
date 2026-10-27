import { randomUUID } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { dirname } from "node:path";
import { parseAdminConfig } from "@hambazi/config";
import { createDatabase } from "@hambazi/database";
import {
  AdminFault,
  adminCeremonySchema,
  createAdminCrypto,
  createAdminProvisioningModule,
} from "../admin/index.js";
import {
  actualTerminal,
  appendCeremonyAudit,
  assertStagingOperator,
  hiddenLine,
  lockPrivate,
  parsePrivateEnvironment,
  readPrivate,
  stagingOwnerProfile,
  writePrivateJson,
  operatorDebugging,
  requireCeremonySafety,
  privateDirectory,
} from "./admin-owner-private.js";
import {
  ownerStateSchema,
  planOwnerCeremony,
  stagingAuthority,
  verifyBackupReceipt,
  type OwnerCeremonyState,
  stagingOwnerPolicySchema,
  operatorDatabaseUrl,
} from "./admin-owner-state.js";

const root = "/opt/hambazi/admin/private";
let database: ReturnType<typeof createDatabase> | undefined;
let unlock: (() => Promise<void>) | undefined;
let audit: { action: "bootstrap" | "recover"; commandId: string } | undefined;
try {
  const [action, flag, ...rest] = process.argv.slice(2);
  if ((action !== "bootstrap" && action !== "recover") || rest.length) throw new Error();
  audit = { action, commandId: randomUUID() };
  // The policy file is installed only after approval of this exact Staging release.
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
    acknowledged: flag === "--confirm-private-owner-ceremony",
  });
  const limits = await readFile("/proc/self/limits", "utf8");
  if (!/^Max core file size\s+0\s+/m.test(limits)) throw new Error();
  await requireCeremonySafety();
  verifyBackupReceipt(
    JSON.parse((await readPrivate(root + "/owner-backup-rehearsal.json")).toString()),
    policy.sourceRevision,
  );
  unlock = await lockPrivate(root + "/owner-ceremony.lock");
  let state: OwnerCeremonyState | null = null;
  try {
    state = ownerStateSchema.parse(
      JSON.parse((await readPrivate(root + "/owner-checkpoint.json")).toString()),
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const commandId = state?.pending?.commandId ?? randomUUID();
  audit = { action, commandId };
  await appendCeremonyAudit(root + "/owner-ceremony.audit.jsonl", { ...audit, outcome: "STARTED" });
  const environment = parsePrivateEnvironment(
    (await readPrivate(root + "/runtime.env")).toString(),
  );
  const operator = parsePrivateEnvironment(
    (await readPrivate(root + "/operator-database.env")).toString(),
  );
  // The adapter uses a distinct URL for each least-privilege ceremony role.
  const rawUrl =
    operator[
      action === "bootstrap" ? "ADMIN_BOOTSTRAP_DATABASE_URL" : "ADMIN_RECOVERY_DATABASE_URL"
    ];
  const url = operatorDatabaseUrl(rawUrl, policy);
  await privateDirectory(dirname(policy.databaseCaFile));
  const ca = await lstat(policy.databaseCaFile);
  if (!ca.isFile() || ca.isSymbolicLink() || ca.uid !== 0 || (ca.mode & 0o022) !== 0)
    throw new Error();
  const config = parseAdminConfig({
    ...environment,
    ADMIN_MUTATIONS_ENABLED: "false",
    ADMIN_OPERATIONS_DATABASE_URL: undefined,
    NODE_ENV: "production",
    ADMIN_DATABASE_URL: url,
  });
  if (
    !config ||
    config.realmId !== "staging" ||
    config.environment !== "staging" ||
    new URL(config.databaseUrl.reveal()).username !==
      (action === "bootstrap" ? "hambazi_admin_bootstrap" : "hambazi_admin_recovery")
  )
    throw new Error();
  process.stdout.write(
    "فقط Staging؛ ضبط ترمینال و اشتراک صفحه باید خاموش باشد. هیچ ورودی نمایش داده نمی‌شود.\n",
  );
  const username = await hiddenLine(process.stdin, process.stdout, "Username مالک");
  const password = await hiddenLine(
    process.stdin,
    process.stdout,
    action === "bootstrap" ? "Password جدید" : "Password فعلی مالک",
  );
  if (
    action === "bootstrap" &&
    (await hiddenLine(process.stdin, process.stdout, "تکرار Password")) !== password
  )
    throw new Error();
  const pin = await hiddenLine(process.stdin, process.stdout, "PIN جدید شش‌رقمی");
  if ((await hiddenLine(process.stdin, process.stdout, "تکرار PIN")) !== pin) throw new Error();
  const confirmation = action === "bootstrap" ? "CREATE OWNER STAGING" : "RECOVER OWNER STAGING";
  if (
    (await hiddenLine(
      process.stdin,
      process.stdout,
      "برای تأیید و خاموش‌بودن ضبط، عبارت " + confirmation + " را وارد کنید",
    )) !== confirmation
  )
    throw new Error();
  const clock = { nowMs: () => Date.now() };
  const crypto = createAdminCrypto({ ...config, clock });
  const request = adminCeremonySchema.parse({
    schemaVersion: 1,
    commandId,
    username,
    password,
    pin,
    confirmed: true,
    reasonCode: action === "bootstrap" ? "INITIAL_OWNER_ENROLLMENT" : "OWNER_PIN_RECOVERY",
  });
  const digest = crypto.digest(JSON.stringify(request));
  const authority = stagingAuthority(
    { commandId, digest, username: request.username, reasonCode: request.reasonCode },
    clock.nowMs,
  );
  database = createDatabase({
    databaseUrl: config.databaseUrl,
    poolMax: 1,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    transactionMaxWaitMs: 2000,
    transactionTimeoutMs: 5000,
  });
  await database.connect();
  const provision = createAdminProvisioningModule(database, {
    crypto,
    realmId: config.realmId,
    clock,
    newId: randomUUID,
    recoveryPasswordRequired: true,
    verifyAuthority: authority.verify,
  });
  const current = await provision.inspectOwner();
  await requireCeremonySafety();
  const pending: NonNullable<OwnerCeremonyState["pending"]> = { action, commandId, digest };
  await writePrivateJson(
    root + "/owner-checkpoint.json",
    planOwnerCeremony(state, current.ownerId, pending),
  );
  let result: { operatorId: string };
  try {
    result = await provision.run(request, authority.proof);
  } catch (error) {
    // A known authentication denial has no DB effect and must not pin a typo
    // forever. Unknown/commit-ambiguous failures retain the pending checkpoint.
    if (!state?.pending && error instanceof AdminFault && error.code === "FORBIDDEN")
      await writePrivateJson(
        root + "/owner-checkpoint.json",
        state ?? {
          schemaVersion: 1,
          profile: stagingOwnerProfile,
          realm: "staging",
          ownerId: null,
          pending: null,
        },
      );
    throw error;
  }
  // Persist the independent owner binding before recording final success. An
  // interrupted/failed write leaves a pending checkpoint, never an open bootstrap.
  await writePrivateJson(root + "/owner-checkpoint.json", {
    schemaVersion: 1,
    profile: stagingOwnerProfile,
    realm: "staging",
    ownerId: result.operatorId,
    pending: null,
  });
  await appendCeremonyAudit(root + "/owner-ceremony.audit.jsonl", {
    ...audit,
    outcome: "SUCCEEDED",
  });
  process.stdout.write("ADMIN_STAGING_OWNER_CEREMONY_COMPLETED\n");
} catch {
  if (audit)
    await appendCeremonyAudit(root + "/owner-ceremony.audit.jsonl", {
      ...audit,
      outcome: "DENIED",
    }).catch(() => {});
  process.stderr.write("ADMIN_STAGING_OWNER_CEREMONY_DENIED\n");
  process.exitCode = 1;
} finally {
  await database?.disconnect().catch(() => {
    process.exitCode = 1;
  });
  await unlock?.().catch(() => {
    process.exitCode = 1;
  });
}

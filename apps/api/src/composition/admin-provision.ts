import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseAdminConfig } from "@hambazi/config";
import { createDatabase } from "@hambazi/database";
import {
  createAdminCrypto,
  createAdminProvisioningModule,
  createAdminProvisioningAuthority,
} from "../admin/index.js";

async function privateFile(path: string | undefined) {
  if (!path?.startsWith("/")) throw new Error();
  if (resolve(path) !== path) throw new Error();
  for (let parent = dirname(path); ; parent = dirname(parent)) {
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022) !== 0)
      throw new Error();
    if (parent === "/") break;
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o077) !== 0 || stat.size > 16384)
      throw new Error();
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
let database: ReturnType<typeof createDatabase> | undefined;
try {
  // This command never runs at app startup. It requires private inputs, a root operator and two independent proofs.
  if (process.getuid?.() !== 0 || !process.argv.includes("--confirm-private-owner-ceremony"))
    throw new Error();
  const config = parseAdminConfig(process.env);
  if (!config) throw new Error();
  // Staging has one explicit, interactive SSH profile (ADR-084), never a
  // fallback from missing signatures to file-based credentials.
  if (config.realmId === "staging") throw new Error();
  const request = JSON.parse(await privateFile(process.env.ADMIN_CEREMONY_REQUEST_FILE));
  if (
    !request ||
    !["INITIAL_OWNER_ENROLLMENT", "OWNER_PIN_RECOVERY"].includes(request.reasonCode) ||
    new URL(config.databaseUrl.reveal()).username !==
      (request.reasonCode === "INITIAL_OWNER_ENROLLMENT"
        ? "hambazi_admin_bootstrap"
        : "hambazi_admin_recovery")
  )
    throw new Error();
  const proof = JSON.parse(await privateFile(process.env.ADMIN_CEREMONY_PROOF_FILE));
  const clock = { nowMs: () => Date.now() };
  const verifyAuthority = createAdminProvisioningAuthority({
    operatorPublicKey: await privateFile(process.env.ADMIN_OPERATOR_PUBLIC_KEY_FILE),
    ownershipPublicKey: await privateFile(process.env.ADMIN_OWNERSHIP_PUBLIC_KEY_FILE),
    clock,
  });
  const crypto = createAdminCrypto({ ...config, clock });
  database = createDatabase({
    databaseUrl: config.databaseUrl,
    poolMax: 1,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    transactionMaxWaitMs: 2000,
    transactionTimeoutMs: 5000,
  });
  await database.connect();
  await createAdminProvisioningModule(database, {
    crypto,
    realmId: config.realmId,
    clock,
    newId: randomUUID,
    verifyAuthority,
  }).run(request, proof);
  process.stdout.write("ADMIN_CEREMONY_COMPLETED\n");
} catch {
  process.stderr.write("ADMIN_CEREMONY_DENIED\n");
  process.exitCode = 1;
} finally {
  await database?.disconnect().catch(() => {
    process.exitCode = 1;
  });
}

import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { BlockList } from "node:net";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import * as config from "../../packages/config/dist/index.js";
import { roles, buildIdentity } from "./build.mjs";
import { projectScan } from "../ci/scan-evidence.mjs";
import { runGate } from "../ci/gates.mjs";
import { verifyBrowserPolicyArtifact } from "../../apps/web/security/browser-policy.ts";
import { telegramSdkIntegrity } from "../../apps/web/src/platform/telegram-sdk.ts";
import { operatorProfile, operatorLogging } from "./monitoring.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const invalid = () => {
  throw new Error("DEPLOYMENT_PREPARATION_INVALID");
};
const hash = (data) => createHash("sha256").update(data).digest("hex");
const privateIps = new BlockList();
for (const [address, prefix] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
])
  privateIps.addSubnet(address, prefix);
const privateIp = (address) => {
  try {
    return typeof address === "string" && privateIps.check(address, "ipv4");
  } catch {
    return false;
  }
};
const exact = (value, keys) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  )
    invalid();
};
const groups = {
  operations: ["HEALTH_PORT", "HEALTH_PROBE_TIMEOUT_MS", "DRAIN_TIMEOUT_MS", "METRICS_ENABLED"],
  api: [
    "NODE_EXTRA_CA_CERTS",
    "API_DATABASE_URL",
    "API_REDIS_URL",
    "API_PORT",
    "ALLOWED_ORIGINS",
    "API_BIND_ADDRESS",
    "API_DB_POOL_MAX",
    "API_TRUSTED_PROXIES",
    "TELEGRAM_BOT_TOKEN",
    "AUTH_SESSION_SECONDS",
    "AUTH_TELEGRAM_MAX_AGE_SECONDS",
    "AUTH_TELEGRAM_FUTURE_SKEW_SECONDS",
    "AUTH_IP_LIMIT",
    "AUTH_IDENTITY_LIMIT",
    "AUTH_ACTIVE_KEY_ID",
    "AUTH_ISSUER",
    "AUTH_AUDIENCE",
    "AUTH_SIGNING_KEYS",
    "PROFILE_READ_LIMIT",
    "PROFILE_WRITE_LIMIT",
    "CATALOG_READ_LIMIT",
    "BOT_INTERNAL_ENABLED",
    "BOT_INTERNAL_BIND_ADDRESS",
    "BOT_INTERNAL_PORT",
    "BOT_INTERNAL_TLS_KEY_FILE",
    "BOT_INTERNAL_TLS_CERT_FILE",
    "BOT_INTERNAL_REQUEST_LIMIT",
    "BOT_INTERNAL_IDENTITY_LIMIT",
    "BOT_ONBOARDING_LEASE_MS",
    "BOT_SERVICE_ACTIVE_KEY_ID",
    "BOT_SERVICE_KEYS",
    "BOT_SERVICE_ALLOWED_PEERS",
    "TELEGRAM_WEBHOOK_SECRET",
    "ADMISSION_HTTP_PER_MINUTE",
    "ADMISSION_ENGINE_PER_MINUTE",
    "ADMISSION_CONNECT_PER_MINUTE",
    "ADMISSION_EVENT_PER_MINUTE",
    "ADMISSION_HTTP_IN_FLIGHT",
    "ADMISSION_ENGINE_IN_FLIGHT",
    "ADMISSION_CONNECTIONS",
    "ADMISSION_PENDING_PER_SOCKET",
    "ADMISSION_PENDING_TOTAL",
    "ADMISSION_SUBSCRIPTIONS",
  ],
  bot: [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_BOT_USERNAME",
    "TELEGRAM_WEBHOOK_SECRET",
    "BOT_SERVICE_KEY_ID",
    "BOT_SERVICE_KEY",
    "BOT_API_ORIGIN",
    "BOT_API_CA_FILE",
    "BOT_BIND_ADDRESS",
    "BOT_PORT",
    "BOT_TLS_KEY_FILE",
    "BOT_TLS_CERT_FILE",
    "BOT_MINI_APP_URL",
    "BOT_BACKEND_TIMEOUT_MS",
    "BOT_SEND_TIMEOUT_MS",
    "BOT_ONBOARDING_LEASE_MS",
    "BOT_MAX_IN_FLIGHT",
  ],
  worker: [
    "NODE_EXTRA_CA_CERTS",
    "WORKER_DATABASE_URL",
    "WORKER_REDIS_URL",
    "WORKER_QUEUE_NAMESPACE",
    "WORKER_DB_POOL_MAX",
    "BOT_CLEANUP_INTERVAL_MS",
    "BOT_CLEANUP_BATCH_SIZE",
    "BOT_CLEANUP_ATTEMPTS",
    "BOT_CLEANUP_BACKOFF_MS",
  ],
  web: ["WEB_BIND_ADDRESS", "WEB_PORT", "WEB_HEALTH_PORT"],
};

/** Literal single-line KEY=value files: no shell, quotes, interpolation or dotenv fallback. */
export function parseRoleFile(text, role) {
  if (!roles.includes(role) || typeof text !== "string" || Buffer.byteLength(text) > 32768)
    invalid();
  const allowed = new Set([
    "NODE_ENV",
    ...groups[role],
    ...(role === "web" ? [] : groups.operations.map((key) => `${role.toUpperCase()}_${key}`)),
  ]);
  const env = Object.create(null);
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=([\x20-\x7E]*)$/.exec(line);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(env, match[1])) invalid();
    env[match[1]] = match[2];
  }
  if (env.NODE_ENV !== "production") invalid();
  return env;
}

export function validateInventory(manifest, report) {
  verifyBrowserPolicyArtifact(manifest?.browserPolicy, telegramSdkIntegrity);
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.purpose !== "local-packaging-candidate" ||
    manifest.productionReleaseApproved !== false ||
    manifest.platform !== "linux/amd64" ||
    !/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? "") ||
    typeof manifest.sourceDirty !== "boolean" ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceSnapshotSha256 ?? "") ||
    buildIdentity(manifest.sourceSnapshotSha256, manifest.browserPolicy) !==
      manifest.buildInputSha256 ||
    !Array.isArray(manifest.images) ||
    manifest.images.length !== 4
  )
    invalid();
  const scan = projectScan(report, "application-images");
  for (const key of ["sourceCommit", "sourceDirty", "sourceSnapshotSha256", "buildInputSha256"])
    if (scan[key] !== manifest[key]) invalid();
  for (const [index, role] of roles.entries()) {
    const entry = manifest.images[index];
    if (
      entry?.role !== role ||
      !new RegExp(
        `^hambazi-candidate/${role}:${manifest.sourceCommit}-${manifest.buildInputSha256.slice(0, 16)}@sha256:[a-f0-9]{64}$`,
      ).test(entry.image ?? "") ||
      scan.images[index].image !== entry.image
    )
      invalid();
  }
  return scan;
}

/** Preparation restrictions deliberately exclude deferred gameplay/export activation. */
export function validateEnvironments(envs, inputs) {
  try {
    const operator = inputs.operatorMonitoring === operatorProfile;
    if (inputs.operatorMonitoring !== undefined && !operator) invalid();
    const api = envs.api,
      bot = envs.bot,
      worker = envs.worker,
      web = envs.web;
    if (
      api.NODE_EXTRA_CA_CERTS !== undefined ||
      worker.NODE_EXTRA_CA_CERTS !== undefined ||
      inputs.tlsFiles?.dataCa !== undefined
    ) {
      if (
        api.NODE_EXTRA_CA_CERTS !== "/run/hambazi/tls/data-ca.pem" ||
        worker.NODE_EXTRA_CA_CERTS !== "/run/hambazi/tls/data-ca.pem" ||
        !inputs.tlsFiles?.dataCa ||
        new URL(api.API_DATABASE_URL).searchParams.get("sslmode") !== "verify-full" ||
        new URL(worker.WORKER_DATABASE_URL).searchParams.get("sslmode") !== "verify-full"
      )
        invalid();
    }
    config.parseRuntimeConfig(api, "api");
    config.parseRuntimeConfig(worker, "worker");
    config.parseAuthRuntimeConfig(api);
    config.parseProfileConfig(api);
    config.parseCatalogConfig(api);
    config.parseTransportAdmissionConfig(api);
    const internal = config.parseBotInternalConfig(api),
      verifier = config.parseBotServiceConfig(api);
    const botConfig = config.parseBotRuntimeConfig(bot);
    config.parseOnboardingWorkerConfig(worker);
    if (
      !internal ||
      api.API_BIND_ADDRESS !== "0.0.0.0" ||
      internal.bindAddress !== inputs.privateAddresses.api ||
      botConfig.bindAddress !== inputs.privateAddresses.bot ||
      api.BOT_SERVICE_ALLOWED_PEERS !== inputs.privateAddresses.bot ||
      bot.BOT_API_ORIGIN !== `https://${inputs.privateAddresses.api}:${internal.port}` ||
      api.TELEGRAM_BOT_TOKEN !== bot.TELEGRAM_BOT_TOKEN ||
      api.TELEGRAM_WEBHOOK_SECRET !== bot.TELEGRAM_WEBHOOK_SECRET ||
      !verifier.keys.some(
        (key) => key.id === bot.BOT_SERVICE_KEY_ID && key.secret.reveal() === bot.BOT_SERVICE_KEY,
      ) ||
      api.BOT_INTERNAL_TLS_KEY_FILE !== "/run/hambazi/tls/key.pem" ||
      api.BOT_INTERNAL_TLS_CERT_FILE !== "/run/hambazi/tls/cert.pem" ||
      bot.BOT_TLS_KEY_FILE !== "/run/hambazi/tls/key.pem" ||
      bot.BOT_TLS_CERT_FILE !== "/run/hambazi/tls/cert.pem" ||
      bot.BOT_API_CA_FILE !== "/run/hambazi/tls/api-ca.pem" ||
      web.WEB_BIND_ADDRESS !== "0.0.0.0"
    )
      invalid();
    for (const kind of ["DATABASE", "REDIS"]) {
      const a = new URL(api[`API_${kind}_URL`]),
        w = new URL(worker[`WORKER_${kind}_URL`]);
      if (
        a.hostname !== w.hostname ||
        a.port !== w.port ||
        a.pathname !== w.pathname ||
        decodeURIComponent(a.username) !== (kind === "DATABASE" ? "hambazi_api" : "api") ||
        decodeURIComponent(w.username) !== (kind === "DATABASE" ? "hambazi_worker" : "worker") ||
        decodeURIComponent(a.password) === decodeURIComponent(w.password)
      )
        invalid();
      // A private IP is directly checked; DNS targets require staging resolution/firewall evidence.
      if (a.hostname.startsWith("[") || (/^[\d.]+$/.test(a.hostname) && !privateIp(a.hostname)))
        invalid();
    }
    for (const role of roles) {
      const env = envs[role],
        prefix = role.toUpperCase();
      const ports =
        role === "web"
          ? [env.WEB_PORT, env.WEB_HEALTH_PORT]
          : [
              env[`${prefix}_HEALTH_PORT`],
              ...(role === "api"
                ? [env.API_PORT, env.BOT_INTERNAL_PORT]
                : role === "bot"
                  ? [env.BOT_PORT]
                  : []),
            ];
      if (
        new Set(ports).size !== ports.length ||
        ports.some((port) => !/^\d+$/.test(port ?? "") || +port < 1024 || +port > 65535)
      )
        invalid();
      let budget = 0;
      if (role !== "web") {
        budget = config.parseOperationsConfig(env, role).drainTimeoutMs;
        config.parseTelemetryConfig(env, role);
        if (
          operator
            ? env[`${prefix}_METRICS_ENABLED`] !== "true"
            : env[`${prefix}_METRICS_ENABLED`] && env[`${prefix}_METRICS_ENABLED`] !== "false"
        )
          invalid();
      }
      if (
        !Number.isSafeInteger(inputs.stopGraceSeconds[role]) ||
        inputs.stopGraceSeconds[role] < 1 ||
        inputs.stopGraceSeconds[role] > 180 ||
        inputs.stopGraceSeconds[role] * 1000 <= budget + 3000
      )
        invalid();
    }
  } catch {
    invalid();
  }
}

export async function privateFile(path, secret = true) {
  if (!isAbsolute(path ?? "") || [...path].some((c) => c.charCodeAt(0) < 32 || c === "$"))
    invalid();
  // Disallow symbolic links in any path component, not just the final file.
  let current = resolve(path);
  const info = await lstat(current);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 1024 * 1024 ||
    (secret && (info.mode & 0o077) !== 0)
  )
    invalid();
  while (current !== "/") {
    if ((await lstat(current)).isSymbolicLink()) invalid();
    current = resolve(current, "..");
  }
  return readFile(path);
}

export async function compatibilityInputs() {
  const migrations = [];
  for (const id of (await readdir(join(root, "packages/database/prisma/migrations"))).sort()) {
    if (id === "migration_lock.toml") continue;
    if (!/^\d{12}_[a-z_]+$/.test(id)) invalid();
    migrations.push({
      id,
      sha256: hash(
        await readFile(join(root, "packages/database/prisma/migrations", id, "migration.sql")),
      ),
    });
  }
  const contracts = [];
  for (const name of (await readdir(join(root, "docs/contracts"))).sort()) {
    if (name.endsWith(".baseline.json"))
      contracts.push({
        path: `docs/contracts/${name}`,
        sha256: hash(await readFile(join(root, "docs/contracts", name))),
      });
  }
  return {
    migrations,
    contracts,
    permissionsSha256: hash(await readFile(join(root, "packages/database/prisma/permissions.sql"))),
    compatibilityApproved: false,
    activePinsReviewed: false,
    retainedJobsReviewed: false,
  };
}

export async function prepare(inputsPath, output) {
  const inputsBytes = await privateFile(inputsPath);
  const inputs = JSON.parse(inputsBytes);
  exact(inputs, [
    "schemaVersion",
    "inventory",
    "roleEnvFiles",
    "tlsFiles",
    "privateNetwork",
    "botEgressNetwork",
    "privateAddresses",
    "stopGraceSeconds",
    ...(Object.hasOwn(inputs, "operatorMonitoring") ? ["operatorMonitoring"] : []),
  ]);
  for (const field of ["roleEnvFiles", "privateAddresses", "stopGraceSeconds"])
    exact(inputs[field], roles);
  exact(inputs.tlsFiles, [
    "apiKey",
    "apiCert",
    "botKey",
    "botCert",
    "apiCa",
    ...(Object.hasOwn(inputs.tlsFiles, "dataCa") ? ["dataCa"] : []),
  ]);
  if (
    inputs.schemaVersion !== 1 ||
    !isAbsolute(output ?? "") ||
    !relative(root, resolve(output)).startsWith("../") ||
    inputs.privateNetwork === inputs.botEgressNetwork ||
    [inputs.privateNetwork, inputs.botEgressNetwork].some(
      (value) => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(value ?? ""),
    ) ||
    Object.values(inputs.privateAddresses).some((address) => !privateIp(address)) ||
    new Set(Object.values(inputs.privateAddresses)).size !== 4 ||
    new Set(Object.values(inputs.roleEnvFiles)).size !== 4
  )
    invalid();
  let parent = dirname(resolve(output));
  while (parent !== "/") {
    if ((await lstat(parent)).isSymbolicLink()) invalid();
    parent = dirname(parent);
  }
  const inventoryBytes = await privateFile(inputs.inventory),
    manifest = JSON.parse(inventoryBytes);
  const scanBytes = await privateFile(`${inputs.inventory}.scan.json`);
  validateInventory(manifest, JSON.parse(scanBytes));
  const privateNetwork = JSON.parse(
    await runGate("deployment-private-network", "docker", [
      "network",
      "inspect",
      inputs.privateNetwork,
    ]),
  )[0];
  const egressNetwork = JSON.parse(
    await runGate("deployment-egress-network", "docker", [
      "network",
      "inspect",
      inputs.botEgressNetwork,
    ]),
  )[0];
  if (
    privateNetwork?.Driver !== "bridge" ||
    privateNetwork.Internal !== true ||
    egressNetwork?.Driver !== "bridge" ||
    egressNetwork.Internal !== false ||
    privateNetwork.Id === egressNetwork.Id
  )
    invalid();
  const subnets = privateNetwork.IPAM?.Config?.map(({ Subnet }) => Subnet) ?? [];
  const inventoryIps = new BlockList();
  for (const subnet of subnets) {
    const match = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(subnet ?? "");
    if (match) inventoryIps.addSubnet(match[1], +match[2]);
  }
  if (Object.values(inputs.privateAddresses).some((ip) => !inventoryIps.check(ip, "ipv4")))
    invalid();
  const envs = {};
  for (const role of roles)
    envs[role] = parseRoleFile((await privateFile(inputs.roleEnvFiles[role])).toString(), role);
  validateEnvironments(envs, inputs);
  const tls = {};
  for (const [name, path] of Object.entries(inputs.tlsFiles))
    tls[name] = await privateFile(path, name.endsWith("Key"));
  for (const role of ["api", "bot"]) {
    const cert = new X509Certificate(tls[`${role}Cert`]);
    if (
      !cert.checkPrivateKey(createPrivateKey(tls[`${role}Key`])) ||
      !cert.checkIP(inputs.privateAddresses[role]) ||
      Date.parse(cert.validTo) <= Date.now() ||
      Date.parse(cert.validFrom) > Date.now()
    )
      invalid();
  }
  // The supplied CA must actually verify the private API's leaf, not just exist.
  const apiCert = new X509Certificate(tls.apiCert),
    ca = new X509Certificate(tls.apiCa);
  if (
    !apiCert.verify(ca.publicKey) ||
    Date.parse(ca.validTo) <= Date.now() ||
    Date.parse(ca.validFrom) > Date.now()
  )
    invalid();
  if (tls.dataCa) {
    const dataCa = new X509Certificate(tls.dataCa);
    if (
      !dataCa.ca ||
      Date.parse(dataCa.validTo) <= Date.now() ||
      Date.parse(dataCa.validFrom) > Date.now()
    )
      invalid();
  }
  const substitutions = {
    PRIVATE_NETWORK: inputs.privateNetwork,
    BOT_EGRESS_NETWORK: inputs.botEgressNetwork,
    API_TLS_KEY_FILE: inputs.tlsFiles.apiKey,
    API_TLS_CERT_FILE: inputs.tlsFiles.apiCert,
    BOT_TLS_KEY_FILE: inputs.tlsFiles.botKey,
    BOT_TLS_CERT_FILE: inputs.tlsFiles.botCert,
    BOT_API_CA_FILE: inputs.tlsFiles.apiCa,
  };
  for (const [index, role] of roles.entries()) {
    const prefix = role.toUpperCase();
    substitutions[`${prefix}_IMAGE`] = manifest.images[index].image;
    substitutions[`${prefix}_ENV_FILE`] = inputs.roleEnvFiles[role];
    substitutions[`${prefix}_PRIVATE_IP`] = inputs.privateAddresses[role];
    substitutions[`${prefix}_STOP_GRACE_SECONDS`] = String(inputs.stopGraceSeconds[role]);
  }
  const template = await readFile(join(root, "infra/docker/release/compose.yaml"), "utf8");
  const rendered = template.replace(/\$\{([A-Z_]+):\?[^}]+\}/g, (_, key) =>
    JSON.stringify(substitutions[key] ?? invalid()),
  );
  // Numeric duration interpolation needs one YAML scalar, rather than a quoted prefix.
  let compose = rendered.replace(/stop_grace_period: "(\d+)"s/g, 'stop_grace_period: "$1s"');
  const definition = parse(compose, { merge: true });
  if (inputs.operatorMonitoring === operatorProfile || tls.dataCa) {
    for (const role of roles) {
      if (inputs.operatorMonitoring === operatorProfile)
        definition.services[role].logging = structuredClone(operatorLogging);
      if (tls.dataCa && ["api", "worker"].includes(role))
        (definition.services[role].volumes ??= []).push({
          type: "bind",
          source: inputs.tlsFiles.dataCa,
          target: "/run/hambazi/tls/data-ca.pem",
          read_only: true,
          bind: { create_host_path: false },
        });
    }
    delete definition["x-runtime"];
    compose = stringify(definition);
  }
  if (Object.keys(definition.services).join() !== roles.join() || compose.includes("${")) invalid();
  await mkdir(output, { mode: 0o700 });
  let complete = false;
  try {
    const composePath = join(output, "compose.yaml");
    await writeFile(composePath, compose, { mode: 0o600, flag: "wx" });
    // No ambient .env or provider settings; raw role files are consumed without interpolation.
    await runGate(
      "deployment-compose-validation",
      "docker",
      [
        "compose",
        "--env-file",
        "/dev/null",
        "--project-name",
        "hambazi-preparation",
        "--file",
        composePath,
        "config",
        "--quiet",
      ],
      { cwd: output },
    );
    const evidence = {
      schemaVersion: 1,
      purpose: "portable-deployment-preparation",
      productionReleaseApproved: false,
      inventorySha256: hash(inventoryBytes),
      scanSha256: hash(scanBytes),
      composeSha256: hash(compose),
      ...(inputs.operatorMonitoring === operatorProfile
        ? {
            operatorMonitoring: {
              profile: operatorProfile,
              logging: operatorLogging,
              access: "SSH Docker exec; container loopback only",
              publicPorts: false,
              snapshotsPersisted: false,
              activationVerified: false,
            },
          }
        : {}),
      privateNetworkVerified: true,
      sourceCommit: manifest.sourceCommit,
      sourceDirty: manifest.sourceDirty,
      buildInputSha256: manifest.buildInputSha256,
      compatibility: await compatibilityInputs(),
      pendingDecisions: ["OD-002", "OD-006", "OD-007"],
      releaseGates: { "7C": "Pending", "17C": "Completed", "18B3": "Pending", 19: "Pending" },
      capacityAcceptance: {
        scope: "MVP",
        reference: "ADR-048",
        performanceExceptions: true,
        productionPerformanceApproved: false,
        productionLikeValidation: "Pending",
      },
    };
    await writeFile(join(output, "preparation.json"), JSON.stringify(evidence, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    complete = true;
    return evidence;
  } finally {
    if (!complete) await rm(output, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) invalid();
    const result = await prepare(resolve(process.argv[2]), process.argv[3]);
    console.info(
      JSON.stringify({
        schemaVersion: 1,
        purpose: result.purpose,
        validated: true,
        productionReleaseApproved: false,
      }),
    );
  } catch {
    console.error("DEPLOYMENT_PREPARATION_FAILED");
    process.exitCode = 1;
  }
}

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, chmod, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { afterEach, expect, it } from "vitest";
import {
  parseRoleFile,
  validateEnvironments,
  validateInventory,
  privateFile,
  prepare,
  compatibilityInputs,
} from "../release/prepare.mjs";
import { runGate } from "../ci/gates.mjs";
import { deploymentFixture } from "./fixtures/deployment.mjs";
import { operatorProfile, operatorLogging } from "../release/monitoring.mjs";
import { buildIdentity } from "../release/build.mjs";

const directories = [],
  networks = [];
afterEach(async () => {
  for (const name of networks.splice(0))
    await runGate("deployment-test-cleanup", "docker", ["network", "rm", name]);
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const lines = (env) =>
  Object.entries(env)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");

it.each(["named", "main"])(
  "prepares dormant restricted Kahroba with paired owner/tester and v2 consumers (%s)",
  (target) => {
    const { envs, inputs } = deploymentFixture();
    inputs.ownerAdmissionFile = "/private/owner.json";
    inputs.stagingTestAdmissionFile = "/private/tester.json";
    for (const role of ["api", "bot"])
      Object.assign(envs[role], {
        AUTH_ADMISSION_POLICY: "telegram-owner-only-v1",
        OWNER_ADMISSION_FILE: "/run/hambazi/owner-admission.json",
        STAGING_TEST_ADMISSION_FILE: "/run/hambazi/staging-test-admission.json",
      });
    envs.api.ALLOWED_ORIGINS = "https://staging.hambazi.top";
    envs.bot.BOT_MINI_APP_URL = "https://staging.hambazi.top/";
    const flags = {
      PERSONAL_GAMEPLAY_PROFILE: "owner-bots-v1",
      KAHROBA_RUNTIME_PROFILE: "restricted-staging-v1",
      KAHROBA_ENGINE_REGISTERED: "false",
      KAHROBA_RUNTIME_ENABLED: "false",
      KAHROBA_ROUTES_ENABLED: "false",
      KAHROBA_ADMISSION_ENABLED: "false",
      KAHROBA_QUEUE_NAMESPACE: "fixture",
      KAHROBA_RECONNECT_LEASE_MS: "30000",
      KAHROBA_RECONNECT_GRACE_MS: "30000",
    };
    Object.assign(envs.api, flags, {
      ROOM_TTL_SECONDS: "900",
      ROOM_READ_LIMIT: "60",
      ROOM_CREATE_LIMIT: "6",
      ROOM_BOT_USERNAME: "HamBaziFixtureBot",
      ROOM_APP_NAME: "play",
      ROOM_INVITE_LIMIT: "60",
    });
    Object.assign(envs.worker, flags, {
      STATS_ENABLED: "true",
      STATS_CONCURRENCY: "1",
      STATS_DRAIN_TIMEOUT_MS: "15000",
      MATCH_OUTBOX_ENABLED: "true",
      MATCH_OUTBOX_INTERVAL_MS: "1000",
      MATCH_OUTBOX_BATCH_SIZE: "10",
      MATCH_OUTBOX_LEASE_MS: "10000",
      MATCH_OUTBOX_ATTEMPTS: "5",
      MATCH_OUTBOX_BACKOFF_MS: "1000",
      MATCH_OUTBOX_MAX_BACKOFF_MS: "60000",
      MATCH_OUTBOX_PUBLISH_TIMEOUT_MS: "2000",
    });
    if (target === "main") {
      delete envs.api.ROOM_APP_NAME;
      envs.api.ROOM_MAIN_APP = "true";
    }
    for (const role of ["api", "worker"]) envs[role] = parseRoleFile(lines(envs[role]), role);
    expect(() => validateEnvironments(envs, inputs)).not.toThrow();
    for (const patch of [
      (e) => {
        e.worker.KAHROBA_QUEUE_NAMESPACE = "other";
      },
      (e) => {
        e.api.KAHROBA_RUNTIME_PROFILE = "local-private-v1";
      },
      (e) => {
        e.worker.STATS_ENABLED = "false";
      },
      (e) => {
        delete e.api.ROOM_APP_NAME;
        delete e.api.ROOM_MAIN_APP;
      },
      (_e, i) => {
        delete i.stagingTestAdmissionFile;
      },
    ]) {
      const e = structuredClone(envs),
        i = structuredClone(inputs);
      patch(e, i);
      expect(() => validateEnvironments(e, i)).toThrow();
    }
  },
);

it("pairs the regular tester reference across API/Bot without replacing owner admission or opening another origin", () => {
  const { envs, inputs } = deploymentFixture();
  inputs.ownerAdmissionFile = "/private/owner.json";
  inputs.stagingTestAdmissionFile = "/private/tester.json";
  for (const role of ["api", "bot"])
    Object.assign(envs[role], {
      AUTH_ADMISSION_POLICY: "telegram-owner-only-v1",
      OWNER_ADMISSION_FILE: "/run/hambazi/owner-admission.json",
      STAGING_TEST_ADMISSION_FILE: "/run/hambazi/staging-test-admission.json",
    });
  envs.api.ALLOWED_ORIGINS = "https://staging.hambazi.top";
  envs.bot.BOT_MINI_APP_URL = "https://staging.hambazi.top/";
  expect(() => validateEnvironments(envs, inputs)).not.toThrow();
  for (const change of [
    (e) => {
      delete e.bot.STAGING_TEST_ADMISSION_FILE;
    },
    (e, i) => {
      delete i.stagingTestAdmissionFile;
    },
    (e, i) => {
      i.stagingTestAdmissionFile = i.ownerAdmissionFile;
    },
    (e) => {
      e.api.ALLOWED_ORIGINS = "https://public.example";
    },
  ]) {
    const e = structuredClone(envs),
      i = structuredClone(inputs);
    change(e, i);
    expect(() => validateEnvironments(e, i)).toThrow("DEPLOYMENT_PREPARATION_INVALID");
  }
});

it("binds complete owner admission for API/Bot and denies partial or unknown profiles", () => {
  const { envs, inputs } = deploymentFixture();
  inputs.ownerAdmissionFile = "/private/owner-admission.json";
  const profile = {
    AUTH_ADMISSION_POLICY: "telegram-owner-only-v1",
    OWNER_ADMISSION_FILE: "/run/hambazi/owner-admission.json",
  };
  Object.assign(envs.api, profile);
  Object.assign(envs.bot, profile);
  expect(() => validateEnvironments(envs, inputs)).not.toThrow();
  delete envs.bot.AUTH_ADMISSION_POLICY;
  expect(() => validateEnvironments(envs, inputs)).toThrow("DEPLOYMENT_PREPARATION_INVALID");
  Object.assign(envs.bot, profile);
  delete inputs.ownerAdmissionFile;
  expect(() => validateEnvironments(envs, inputs)).toThrow("DEPLOYMENT_PREPARATION_INVALID");
});

it("validates actual production role parsers, literal JSON secrets and distinct credentials", () => {
  const { envs, inputs } = deploymentFixture();
  for (const role of Object.keys(envs)) envs[role] = parseRoleFile(lines(envs[role]), role);
  expect(() => validateEnvironments(envs, inputs)).not.toThrow();
});
it("denies unknown/cross-role/migration credentials, duplicates, shell syntax and test profiles without echo", () => {
  const { envs } = deploymentFixture();
  for (const addition of [
    "WORKER_DATABASE_URL=private-canary",
    "MIGRATION_DATABASE_URL=private-canary",
    "NODE_OPTIONS=private-canary",
    "export X=private-canary",
    "NODE_ENV=test",
    "KAHROBA_LOCAL_ADMISSION_FILE=/tmp/local.json",
    "API_SENTRY_DSN=private-canary",
    "API_PORT=8080\r",
  ])
    expect(() => parseRoleFile(lines(envs.api) + addition, "api")).toThrow(
      "DEPLOYMENT_PREPARATION_INVALID",
    );
  expect(() => parseRoleFile(lines(envs.bot) + "AUTH_SIGNING_KEYS=private-canary", "bot")).toThrow(
    "DEPLOYMENT_PREPARATION_INVALID",
  );
});
it("denies plaintext services, reused database/Redis identities and missing production admission policy", () => {
  for (const patch of [
    (e) => {
      e.api.API_REDIS_URL = e.api.API_REDIS_URL.replace("rediss:", "redis:");
    },
    (e) => {
      e.api.API_DATABASE_URL = e.api.API_DATABASE_URL.split("?")[0];
    },
    (e) => {
      e.worker.WORKER_DATABASE_URL = e.api.API_DATABASE_URL;
    },
    (e) => {
      e.worker.WORKER_REDIS_URL = e.api.API_REDIS_URL;
    },
    (e) => {
      e.api.API_DATABASE_URL =
        "postgresql://hambazi_api:synthetic@db.private:5432/hambazi?sslmode=verify-full";
      e.worker.WORKER_DATABASE_URL =
        "postgresql://hambazi_worker:%73ynthetic@db.private:5432/hambazi?sslmode=verify-full";
    },
    (e) => {
      e.api.API_DATABASE_URL = e.api.API_DATABASE_URL.replace("hambazi_api", "hambazi_migrator");
    },
    (e) => {
      delete e.api.ADMISSION_PENDING_TOTAL;
    },
    (e) => {
      e.api.API_REDIS_URL = e.api.API_REDIS_URL.replace("redis.private", "8.8.8.8");
      e.worker.WORKER_REDIS_URL = e.worker.WORKER_REDIS_URL.replace("redis.private", "8.8.8.8");
    },
  ]) {
    const { envs, inputs } = deploymentFixture();
    patch(envs);
    expect(() => validateEnvironments(envs, inputs)).toThrow("DEPLOYMENT_PREPARATION_INVALID");
  }
});
it("denies wrong private peers, service key, TLS mounts, port overlap, exporter or insufficient stop grace", () => {
  for (const patch of [
    (e) => {
      e.api.BOT_SERVICE_ALLOWED_PEERS = "127.0.0.1";
    },
    (e) => {
      e.bot.BOT_SERVICE_KEY = randomBytes(32).toString("base64url");
    },
    (e) => {
      e.bot.BOT_API_CA_FILE = "/tmp/wrong.pem";
    },
    (e) => {
      e.web.WEB_HEALTH_PORT = e.web.WEB_PORT;
    },
    (e) => {
      e.api.API_METRICS_ENABLED = "true";
    },
    (_e, i) => {
      i.stopGraceSeconds.bot = 31;
    },
  ]) {
    const { envs, inputs } = deploymentFixture();
    patch(envs, inputs);
    expect(() => validateEnvironments(envs, inputs)).toThrow("DEPLOYMENT_PREPARATION_INVALID");
  }
});
it("requires explicit private monitoring and matched fixed-path data trust without allowing arbitrary Node options", () => {
  const { envs, inputs } = deploymentFixture();
  inputs.operatorMonitoring = operatorProfile;
  for (const role of ["api", "bot", "worker"])
    envs[role][`${role.toUpperCase()}_METRICS_ENABLED`] = "true";
  expect(() => validateEnvironments(envs, inputs)).not.toThrow();
  inputs.operatorMonitoring = "public";
  expect(() => validateEnvironments(envs, inputs)).toThrow();
  inputs.operatorMonitoring = operatorProfile;
  envs.api.API_METRICS_ENABLED = "false";
  expect(() => validateEnvironments(envs, inputs)).toThrow();
  envs.api.API_METRICS_ENABLED = "true";
  envs.api.NODE_EXTRA_CA_CERTS = "/run/hambazi/tls/data-ca.pem";
  expect(() => validateEnvironments(envs, inputs)).toThrow();
  inputs.tlsFiles = { dataCa: "/private/data-ca.pem" };
  envs.worker.NODE_EXTRA_CA_CERTS = "/run/hambazi/tls/data-ca.pem";
  expect(() => validateEnvironments(envs, inputs)).not.toThrow();
  envs.worker.NODE_EXTRA_CA_CERTS = "/tmp/arbitrary.pem";
  expect(() => validateEnvironments(envs, inputs)).toThrow();
  expect(() => parseRoleFile(lines(envs.bot) + "NODE_EXTRA_CA_CERTS=/tmp/a.pem", "bot")).toThrow();
});
it("binds fresh four-role scans to the exact inventory and policy/source identity", () => {
  const { manifest, report } = deploymentFixture();
  expect(validateInventory(manifest, report).images).toHaveLength(4);
  for (const patch of [
    (m) => {
      m.productionReleaseApproved = true;
    },
    (_m, r) => {
      r.sourceDirty = true;
    },
    (m) => {
      m.images[0].image = m.images[0].image.replace(/@.+$/, "");
    },
    (_m, r) => {
      r.images.reverse();
    },
    (_m, r) => {
      r.database.updatedAt = "2020-01-01T00:00:00Z";
    },
    (m) => {
      m.browserPolicy = { ...m.browserPolicy, headers: {} };
    },
  ]) {
    const f = deploymentFixture();
    patch(f.manifest, f.report);
    expect(() => validateInventory(f.manifest, f.report)).toThrow();
  }
});
it("rejects readable secret files and symlinks including parent directory links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-deployment-test-"));
  directories.push(directory);
  const file = join(directory, "role.env");
  await writeFile(file, "private-canary", { mode: 0o600 });
  expect((await privateFile(file)).toString()).toBe("private-canary");
  await chmod(file, 0o644);
  await expect(privateFile(file)).rejects.toThrow("DEPLOYMENT_PREPARATION_INVALID");
  await chmod(file, 0o600);
  await symlink(file, join(directory, "linked.env"));
  await expect(privateFile(join(directory, "linked.env"))).rejects.toThrow(
    "DEPLOYMENT_PREPARATION_INVALID",
  );
  await symlink(directory, join(directory, "linked-parent"));
  await expect(privateFile(join(directory, "linked-parent", "role.env"))).rejects.toThrow(
    "DEPLOYMENT_PREPARATION_INVALID",
  );
});
it("records all current migrations and contract hashes without approving compatibility", async () => {
  const evidence = await compatibilityInputs();
  expect(evidence.migrations).toHaveLength(16);
  expect(evidence.contracts.length).toBeGreaterThan(10);
  expect(evidence.migrations.every((m) => /^[a-f0-9]{64}$/.test(m.sha256))).toBe(true);
  expect(evidence).toMatchObject({
    compatibilityApproved: false,
    activePinsReviewed: false,
    retainedJobsReviewed: false,
  });
});
it("has no data/ingress provisioning or public ports and denies unresolved example inputs", async () => {
  const definition = parse(
    await readFile(new URL("../docker/release/compose.yaml", import.meta.url), "utf8"),
    { merge: true },
  );
  expect(Object.keys(definition.services)).toEqual(["api", "bot", "worker", "web"]);
  for (const service of Object.values(definition.services)) {
    expect(service).toMatchObject({
      user: "1000:1000",
      read_only: true,
      cap_drop: ["ALL"],
      restart: "no",
      logging: { driver: "none" },
    });
    for (const key of ["ports", "build", "privileged", "network_mode", "command", "entrypoint"])
      expect(service[key]).toBeUndefined();
    expect(service.env_file[0].format).toBe("raw");
  }
  expect(definition.networks.private.external).toBe(true);
  const directory = await mkdtemp(join(tmpdir(), "hambazi-deployment-unresolved-"));
  directories.push(directory);
  const path = join(directory, "inputs.json");
  await writeFile(
    path,
    await readFile(new URL("../docker/release/inputs.example.json", import.meta.url)),
    { mode: 0o600 },
  );
  await expect(prepare(path, join(directory, "output"))).rejects.toThrow(
    "DEPLOYMENT_PREPARATION_INVALID",
  );
});
it("renders a private candidate and validates real Compose without starting services or exporting credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-deployment-render-"));
  directories.push(directory);
  const { envs, inputs, manifest, report } = deploymentFixture();
  inputs.schemaVersion = 1;
  inputs.inventory = join(directory, "images.json");
  inputs.privateNetwork = `hambazi-deployment-test-${randomUUID()}`;
  inputs.botEgressNetwork = `hambazi-deployment-test-${randomUUID()}`;
  await runGate("deployment-test-private", "docker", [
    "network",
    "create",
    "--internal",
    "--subnet",
    "10.99.0.0/24",
    inputs.privateNetwork,
  ]);
  networks.push(inputs.privateNetwork);
  await runGate("deployment-test-egress", "docker", ["network", "create", inputs.botEgressNetwork]);
  networks.push(inputs.botEgressNetwork);
  inputs.roleEnvFiles = {};
  inputs.tlsFiles = {
    apiKey: join(directory, "api-key.pem"),
    apiCert: join(directory, "api-cert.pem"),
    botKey: join(directory, "bot-key.pem"),
    botCert: join(directory, "bot-cert.pem"),
    apiCa: join(directory, "api-cert.pem"),
  };
  for (const role of Object.keys(envs)) {
    inputs.roleEnvFiles[role] = join(directory, `${role}.env`);
    await writeFile(inputs.roleEnvFiles[role], lines(envs[role]), { mode: 0o600 });
  }
  for (const role of ["api", "bot"]) {
    await runGate("deployment-test-tls", "openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      inputs.tlsFiles[`${role}Key`],
      "-out",
      inputs.tlsFiles[`${role}Cert`],
      "-days",
      "1",
      "-subj",
      "/CN=fixture",
      "-addext",
      `subjectAltName=IP:${inputs.privateAddresses[role]}`,
    ]);
    await chmod(inputs.tlsFiles[`${role}Key`], 0o600);
  }
  await writeFile(inputs.inventory, JSON.stringify(manifest), { mode: 0o600 });
  await writeFile(`${inputs.inventory}.scan.json`, JSON.stringify(report), { mode: 0o600 });
  const path = join(directory, "inputs.json");
  await writeFile(path, JSON.stringify(inputs), { mode: 0o600 });
  const output = join(directory, "prepared"),
    evidence = await prepare(path, output);
  expect(evidence.productionReleaseApproved).toBe(false);
  const definition = parse(await readFile(join(output, "compose.yaml"), "utf8"));
  expect(definition.services.api.stop_grace_period).toBe("40s");
  expect(definition.services.bot.volumes).toHaveLength(3);
  for (const mount of definition.services.bot.volumes)
    expect(mount).toMatchObject({ read_only: true, bind: { create_host_path: false } });
  const exported =
    JSON.stringify(evidence) + (await readFile(join(output, "compose.yaml"), "utf8"));
  for (const secret of [
    envs.api.TELEGRAM_BOT_TOKEN,
    envs.api.AUTH_SIGNING_KEYS,
    envs.api.API_DATABASE_URL,
    envs.worker.WORKER_REDIS_URL,
  ])
    expect(exported.includes(secret)).toBe(false);
  await expect(prepare(path, output)).rejects.toThrow();
  expect(await readFile(join(output, "preparation.json"), "utf8")).toContain(
    '"productionReleaseApproved": false',
  );
  const rejectInputs = async (patch) => {
    const changed = structuredClone(inputs);
    patch(changed);
    const invalidPath = join(directory, "invalid-inputs.json");
    await writeFile(invalidPath, JSON.stringify(changed), { mode: 0o600 });
    await expect(prepare(invalidPath, join(directory, "denied-output"))).rejects.toThrow(
      "DEPLOYMENT_PREPARATION_INVALID",
    );
  };
  await rejectInputs((i) => {
    i.tlsFiles.apiKey = i.tlsFiles.botKey;
  });
  await rejectInputs((i) => {
    [i.privateNetwork, i.botEgressNetwork] = [i.botEgressNetwork, i.privateNetwork];
  });
  await rejectInputs((i) => {
    i.privateAddresses.web = "10.98.0.13";
  });
  await rejectInputs((i) => {
    i.roleEnvFiles.bot = i.roleEnvFiles.api;
  });
  await expect(readFile(join(directory, "denied-output/compose.yaml"))).rejects.toThrow();
  inputs.operatorMonitoring = operatorProfile;
  inputs.tlsFiles.dataCa = inputs.tlsFiles.apiCa;
  for (const role of ["api", "bot", "worker"])
    envs[role][`${role.toUpperCase()}_METRICS_ENABLED`] = "true";
  for (const role of ["api", "worker"])
    envs[role].NODE_EXTRA_CA_CERTS = "/run/hambazi/tls/data-ca.pem";
  for (const role of Object.keys(envs))
    await writeFile(inputs.roleEnvFiles[role], lines(envs[role]), { mode: 0o600 });
  await writeFile(path, JSON.stringify(inputs), { mode: 0o600 });
  const operatorOutput = join(directory, "operator-prepared");
  const observed = await prepare(path, operatorOutput);
  const operatorDefinition = parse(await readFile(join(operatorOutput, "compose.yaml"), "utf8"));
  expect(observed.operatorMonitoring).toMatchObject({
    profile: operatorProfile,
    publicPorts: false,
    snapshotsPersisted: false,
    activationVerified: false,
  });
  for (const role of Object.keys(envs)) {
    expect(operatorDefinition.services[role].logging).toEqual(operatorLogging);
    expect(operatorDefinition.services[role].ports).toBeUndefined();
    expect(operatorDefinition.services[role].read_only).toBe(true);
  }
  for (const role of ["api", "worker"])
    expect(operatorDefinition.services[role].volumes).toContainEqual({
      type: "bind",
      source: inputs.tlsFiles.dataCa,
      target: "/run/hambazi/tls/data-ca.pem",
      read_only: true,
      bind: { create_host_path: false },
    });
}, 15000);

function sealedInventoryFixture() {
  const fixture = deploymentFixture();
  fixture.manifest.buildConfiguration = {
    inputTransport: {
      origin: "https://172.17.0.1:54439",
      caSha256: "c".repeat(64),
      inputManifestSha256: "d".repeat(64),
    },
    sourceDateEpoch: "1790000000",
    rewriteTimestamp: true,
  };
  bindSealedIdentity(fixture);
  return fixture;
}
function bindSealedIdentity({ manifest, report }) {
  manifest.buildInputSha256 = buildIdentity(
    manifest.sourceSnapshotSha256,
    manifest.browserPolicy,
    manifest.features,
    manifest.buildConfiguration,
  );
  report.buildInputSha256 = manifest.buildInputSha256;
  for (const [index, entry] of manifest.images.entries()) {
    entry.image = entry.image.replace(
      /:[a-f0-9]{40}-[a-f0-9]{16}@/,
      `:${manifest.sourceCommit}-${manifest.buildInputSha256.slice(0, 16)}@`,
    );
    report.images[index].image = entry.image;
  }
}
it("accepts a sealed build identity bound to its exact fresh four-role scan", () => {
  const { manifest, report } = sealedInventoryFixture();
  expect(validateInventory(manifest, report).images).toHaveLength(4);
});
it("rejects sealed build configuration tampering without a new image and scan identity", () => {
  for (const mutate of [
    (c) => {
      c.sourceDateEpoch = "1790000001";
    },
    (c) => {
      c.inputTransport.caSha256 = "e".repeat(64);
    },
    (c) => {
      c.inputTransport.inputManifestSha256 = "f".repeat(64);
    },
    (c) => {
      c.inputTransport.origin = "https://127.0.0.1:54439";
    },
  ]) {
    const { manifest, report } = sealedInventoryFixture();
    mutate(manifest.buildConfiguration);
    expect(() => validateInventory(manifest, report)).toThrow("DEPLOYMENT_PREPARATION_INVALID");
  }
});
it("rejects invalid or expanded sealed build policy even with a matching calculated hash", () => {
  for (const mutate of [
    (m) => {
      m.buildConfiguration = null;
    },
    (m) => {
      m.buildConfiguration.extra = true;
    },
    (m) => {
      m.buildConfiguration.inputTransport.extra = true;
    },
    (m) => {
      m.buildConfiguration.inputTransport.origin = "https://registry.npmjs.org";
    },
    (m) => {
      m.buildConfiguration.inputTransport.origin = "http://172.17.0.1:54439";
    },
    (m) => {
      m.buildConfiguration.inputTransport.origin = "https://172.17.0.1:443";
    },
    (m) => {
      m.buildConfiguration.inputTransport.origin = "https://user@172.17.0.1:54439";
    },
    (m) => {
      m.buildConfiguration.inputTransport.caSha256 = "invalid";
    },
    (m) => {
      m.buildConfiguration.inputTransport.inputManifestSha256 = "invalid";
    },
    (m) => {
      m.buildConfiguration.sourceDateEpoch = 1790000000;
    },
    (m) => {
      m.buildConfiguration.sourceDateEpoch = "0";
    },
    (m) => {
      m.buildConfiguration.sourceDateEpoch = "1e9";
    },
    (m) => {
      m.buildConfiguration.rewriteTimestamp = false;
    },
  ]) {
    const fixture = sealedInventoryFixture();
    mutate(fixture.manifest);
    bindSealedIdentity(fixture);
    expect(() => validateInventory(fixture.manifest, fixture.report)).toThrow(
      "DEPLOYMENT_PREPARATION_INVALID",
    );
  }
});

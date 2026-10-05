import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepare } from "./prepare.mjs";
import { deploymentFixture } from "../tests/fixtures/deployment.mjs";
import { runGate } from "../ci/gates.mjs";

const directory = await mkdtemp(join(tmpdir(), "hambazi-definition-rehearsal-"));
const project = `hambazi-definition-${randomUUID()}`;
const networks = [];
let stage = "inputs",
  composePath,
  started = false,
  evidence;
const root = fileURLToPath(new URL("../../", import.meta.url));
const run = (command, args) => runGate(`definition-${stage}`, command, args, { cwd: root });
const compose = (args) =>
  run("docker", [
    "compose",
    "--env-file",
    "/dev/null",
    "--project-name",
    project,
    "--file",
    composePath,
    ...args,
  ]);
let checks = 0;
const assert = (condition) => {
  if (!condition) throw new Error();
  checks++;
};
try {
  if (process.argv.length !== 3) throw new Error();
  const { envs, inputs } = deploymentFixture();
  inputs.schemaVersion = 1;
  inputs.inventory = resolve(process.argv[2]);
  inputs.privateNetwork = `${project}-private`;
  inputs.botEgressNetwork = `${project}-egress`;
  stage = "networks";
  await run("docker", [
    "network",
    "create",
    "--internal",
    "--subnet",
    "10.99.0.0/24",
    inputs.privateNetwork,
  ]);
  networks.push(inputs.privateNetwork);
  await run("docker", ["network", "create", inputs.botEgressNetwork]);
  networks.push(inputs.botEgressNetwork);
  inputs.roleEnvFiles = {};
  for (const role of Object.keys(envs)) {
    const path = join(directory, `${role}.env`);
    inputs.roleEnvFiles[role] = path;
    await writeFile(
      path,
      Object.entries(envs[role])
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
      { mode: 0o600, flag: "wx" },
    );
  }
  inputs.tlsFiles = {
    apiKey: join(directory, "api-key.pem"),
    apiCert: join(directory, "api-cert.pem"),
    botKey: join(directory, "bot-key.pem"),
    botCert: join(directory, "bot-cert.pem"),
    apiCa: join(directory, "api-cert.pem"),
  };
  stage = "tls";
  for (const role of ["api", "bot"]) {
    await run("openssl", [
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
  const path = join(directory, "inputs.json");
  await writeFile(path, JSON.stringify(inputs), { mode: 0o600, flag: "wx" });
  stage = "prepare";
  const prepared = await prepare(path, join(directory, "prepared"));
  assert(prepared.privateNetworkVerified === true && prepared.productionReleaseApproved === false);
  composePath = join(directory, "prepared/compose.yaml");
  stage = "compose-web-start";
  started = true;
  // Only Web runs production here. Backend synthetic endpoints are deliberately unavailable.
  await compose([
    "up",
    "--detach",
    "--no-deps",
    "--no-build",
    "--pull",
    "never",
    "--wait",
    "--wait-timeout",
    "60",
    "web",
  ]);
  const container = (await compose(["ps", "--quiet", "web"])).trim();
  assert(/^[a-f0-9]{64}$/.test(container));
  stage = "web-hardening";
  const inspected = JSON.parse(await run("docker", ["inspect", container]))[0];
  assert(
    inspected.Config.User === "1000:1000" && inspected.Config.Env.includes("NODE_ENV=production"),
  );
  assert(inspected.HostConfig.ReadonlyRootfs === true && inspected.HostConfig.Privileged === false);
  assert(
    inspected.HostConfig.CapDrop.includes("ALL") &&
      inspected.HostConfig.SecurityOpt.includes("no-new-privileges:true"),
  );
  assert(!Object.keys(inspected.HostConfig.PortBindings ?? {}).length);
  assert(
    inspected.HostConfig.NetworkMode !== "host" &&
      Object.keys(inspected.NetworkSettings.Networks).length === 1,
  );
  assert(inspected.HostConfig.Tmpfs["/tmp"].includes("noexec"));
  assert(inspected.HostConfig.LogConfig.Type === "none");
  stage = "web-headers-health";
  const manifest = JSON.parse(await readFile(inputs.inventory, "utf8"));
  const probe = `const r=await fetch('http://127.0.0.1:8080'); const h=await fetch('http://127.0.0.1:8081/v1/health/ready'); const s=await h.json(); if(!r.ok||r.headers.get('cache-control')!=='no-store'||r.headers.get('content-security-policy')!==${JSON.stringify(manifest.browserPolicy.headers["Content-Security-Policy"])}||s.status!=='READY'||process.getuid()!==1000)process.exit(1);`;
  await run("docker", ["exec", container, "node", "--input-type=module", "-e", probe]);
  checks++;
  stage = "compose-web-stop";
  await compose(["stop", "web"]);
  assert(
    (await run("docker", ["inspect", "--format", "{{.State.ExitCode}}", container])).trim() === "0",
  );
  stage = "compose-web-redeploy";
  await compose([
    "up",
    "--detach",
    "--no-deps",
    "--no-build",
    "--pull",
    "never",
    "--wait",
    "--wait-timeout",
    "60",
    "web",
  ]);
  await run("docker", ["exec", container, "node", "/opt/hambazi/healthcheck.mjs"]);
  checks++;
  await compose(["stop", "web"]);
  assert(
    (await run("docker", ["inspect", "--format", "{{.State.ExitCode}}", container])).trim() === "0",
  );
  evidence = {
    schemaVersion: 1,
    purpose: "disposable-definition-rehearsal",
    checks,
    passed: true,
    productionReady: false,
    backendProductionTested: false,
  };
} catch {
  console.error(`DEFINITION_REHEARSAL_FAILED:${stage}`);
  process.exitCode = 1;
} finally {
  let cleaned = true;
  if (started)
    try {
      await compose(["down", "--timeout", "40"]);
    } catch {
      cleaned = false;
    }
  for (const name of networks.reverse())
    try {
      await runGate("definition-cleanup", "docker", ["network", "rm", name]);
    } catch {
      cleaned = false;
    }
  if (cleaned) await rm(directory, { recursive: true, force: true });
  else {
    console.error("DEFINITION_REHEARSAL_CLEANUP_FAILED");
    process.exitCode = 1;
  }
}
if (!process.exitCode && evidence) console.info(JSON.stringify(evidence));

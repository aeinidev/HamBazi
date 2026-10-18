import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  mkdir,
  rm,
  readdir,
  lstat,
  rename,
  chmod,
  chown,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash, X509Certificate, createPrivateKey } from "node:crypto";
import { assessImage, assertFreshDatabase, verifyTool } from "../scripts/security-scan.mjs";
import { componentSourceCommit } from "./component-provenance.mjs";
const execute = promisify(execFile);
const root = "/opt/hambazi-staging/private/execution-20261008";
const environment = { PATH: process.env.PATH, HOME: "/root", LANG: "C.UTF-8" };
const hash = (b) => createHash("sha256").update(b).digest("hex");
const check = (ok) => {
  if (!ok) throw new Error("STAGING_RENEWAL_PREREQUISITE_FAILED");
};
async function run(binary, args, timeout = 180000) {
  return (
    await execute(binary, args, {
      env: environment,
      timeout,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024 * 1024,
    })
  ).stdout;
}
async function json(path, secret = true) {
  const info = await lstat(path);
  check(info.isFile() && !info.isSymbolicLink() && (!secret || (info.mode & 0o077) === 0));
  return JSON.parse(await readFile(path, "utf8"));
}
let stage = "prerequisites",
  temporary,
  selectedAcmeImage;
try {
  check(process.argv.length === 3 && ["--renew", "--dry-run"].includes(process.argv[2]));
  check(
    (await run("docker", ["info", "--format", "{{.ID}}"])).trim() ===
      "342f251a-9e56-4353-af12-a32429b7a2e7",
  );
  const inventory = await json(join(root, "release/components.json"));
  check(
    inventory.schemaVersion === 1 &&
      inventory.sourceDirty === false &&
      inventory.images.length === 2,
  );
  const acme = inventory.images.find((i) => i.role === "acme");
  selectedAcmeImage = acme.image;
  const pins = inventory.images;
  for (const item of pins) {
    const identity = JSON.parse(await run("docker", ["image", "inspect", item.image]))[0];
    check(
      identity.Id === item.image.split("@")[1] &&
        identity.Architecture === "amd64" &&
        identity.Config.Labels["org.opencontainers.image.revision"] ===
          componentSourceCommit(inventory, item) &&
        identity.Config.Labels["io.hambazi.component-input-sha256"] === item.buildInputSha256,
    );
  }
  const scanner = join(root, "scanner/trivy"),
    cache = join(root, "scanner/cache");
  await verifyTool(scanner, "trivy");
  await mkdir(cache, { mode: 0o700, recursive: true });
  stage = "fresh-database";
  await run(scanner, ["image", "--download-db-only", "--cache-dir", cache, "--quiet"]);
  const database = assertFreshDatabase(await json(join(cache, "db/metadata.json"), false));
  stage = "exact-components-scan";
  const scannedAt = new Date().toISOString(),
    id = scannedAt.replace(/[^0-9]/g, "");
  temporary = join(root, "scanner", "attempt-" + id);
  await mkdir(temporary, { mode: 0o700 });
  const results = [];
  for (const item of pins) {
    const output = join(temporary, item.role + ".json");
    await run(scanner, [
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
      item.image,
    ]);
    const result = assessImage(JSON.parse(await readFile(output, "utf8")), item.image);
    check(result.ok);
    results.push({ role: item.role, ...result });
  }
  const records = join(root, "renewal-evidence");
  await mkdir(records, { mode: 0o700, recursive: true });
  const evidence = {
    schemaVersion: 1,
    scannedAt,
    database,
    images: results,
    ok: true,
    certificateRenewalPassed: false,
    dryRun: process.argv[2] === "--dry-run",
  };
  assertFreshDatabase({
    Version: 2,
    UpdatedAt: database.updatedAt,
    DownloadedAt: database.downloadedAt,
  });
  stage = "acme";
  const args = [
    "run",
    "--rm",
    "--pull",
    "never",
    "--name",
    "hambazi-staging-acme-renew",
    "--log-driver",
    "none",
    "--network",
    "hambazi-staging-bot-egress",
    "--ip",
    "10.89.19.4",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--tmpfs",
    "/tmp:rw,nosuid,noexec,size=32m,mode=1777",
  ];
  for (const [src, dst] of [
    ["acme-state", "/etc/letsencrypt"],
    ["acme-work", "/run/acme-work"],
    ["acme-logs", "/run/acme-logs"],
    ["acme-webroot", "/var/www/acme"],
  ])
    args.push("--mount", "type=bind,src=" + join(root, src) + ",dst=" + dst);
  args.push(
    acme.image,
    "renew",
    "--non-interactive",
    "--no-random-sleep-on-renew",
    "--config-dir",
    "/etc/letsencrypt",
    "--work-dir",
    "/run/acme-work",
    "--logs-dir",
    "/run/acme-logs",
    "--cert-name",
    "hambazi-staging",
  );
  if (evidence.dryRun) args.push("--dry-run");
  await run("docker", args, 180000);
  if (!evidence.dryRun) {
    stage = "certificate-validation";
    const source = join(root, "acme-state/live/hambazi-staging"),
      destination = join(root, "public-tls");
    const cert = await readFile(join(source, "fullchain.pem")),
      key = await readFile(join(source, "privkey.pem"));
    const leaf = new X509Certificate(cert);
    check(
      leaf.checkPrivateKey(createPrivateKey(key)) &&
        Date.parse(leaf.validTo) > Date.now() + 7 * 86400000,
    );
    for (const host of [
      "staging.hambazi.top",
      "api-staging.hambazi.top",
      "bot-staging.hambazi.top",
    ])
      check(leaf.checkHost(host) === host);
    check(leaf.subjectAltName?.split(", ").length === 3);
    for (const [name, bytes] of [
      ["fullchain.pem", cert],
      ["privkey.pem", key],
    ]) {
      const path = join(destination, name),
        previous = await readFile(path);
      if (hash(previous) === hash(bytes)) continue;
      const next = path + ".new";
      await writeFile(next, bytes, { flag: "wx", mode: 0o600 });
      await chown(next, 1000, 1000);
      await rename(next, path);
    }
    stage = "ingress-reload";
    await run("docker", [
      "exec",
      "hambazi-staging-platform-ingress-1",
      "nginx",
      "-t",
      "-c",
      "/etc/hambazi/nginx.conf",
    ]);
    await run("docker", [
      "exec",
      "hambazi-staging-platform-ingress-1",
      "nginx",
      "-s",
      "reload",
      "-c",
      "/etc/hambazi/nginx.conf",
    ]);
  }
  evidence.certificateRenewalPassed = true;
  await writeFile(join(records, id + ".json"), JSON.stringify(evidence, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const retained = (await readdir(records)).filter((n) => /^\d{17}\.json$/.test(n)).sort();
  for (const name of retained.slice(0, Math.max(0, retained.length - 7)))
    await rm(join(records, name));
  // Certbot's private diagnostics are bounded; no application data enters this volume.
  for (const name of await readdir(join(root, "acme-logs"))) {
    if (!/^letsencrypt\.log(?:\.\d+)?$/.test(name)) continue;
    const path = join(root, "acme-logs", name),
      info = await lstat(path);
    check(info.isFile() && !info.isSymbolicLink());
    await chmod(path, 0o600);
    if (info.size > 1024 * 1024 || (name !== "letsencrypt.log" && name !== "letsencrypt.log.1"))
      await rm(path);
  }
  console.info(
    JSON.stringify({ event: "staging.renewal.passed", dryRun: evidence.dryRun, scannedAt }),
  );
} catch {
  if (stage === "acme" && selectedAcmeImage) {
    try {
      const state = JSON.parse(
        await run("docker", ["inspect", "hambazi-staging-acme-renew"], 5000),
      )[0];
      if (state.Config.Image === selectedAcmeImage)
        await run("docker", ["stop", "--timeout", "10", "hambazi-staging-acme-renew"], 20000);
    } catch {
      /* The one-shot may already have removed itself. */
    }
  }
  console.error(JSON.stringify({ event: "staging.renewal.blocked", stage }));
  process.exitCode = 1;
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}

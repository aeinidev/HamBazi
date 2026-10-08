import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, lstat, writeFile, rename, chown } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const execute = promisify(execFile);
const root = "/opt/hambazi-staging/private/execution-20261008";
const canonical = fileURLToPath(new URL("../docker/staging/hold.routes.conf", import.meta.url));
const hash = (b) => createHash("sha256").update(b).digest("hex");
const run = async (args) =>
  (
    await execute("docker", args, {
      timeout: 10000,
      killSignal: "SIGKILL",
      maxBuffer: 65536,
      env: { PATH: process.env.PATH, HOME: "/root" },
    })
  ).stdout;
try {
  if (
    process.argv.length !== 2 ||
    (await run(["info", "--format", "{{.ID}}"])).trim() !== "342f251a-9e56-4353-af12-a32429b7a2e7"
  )
    throw new Error();
  const active = JSON.parse(await run(["inspect", "hambazi-staging-platform-ingress-1"]))[0];
  const inventory = JSON.parse(await readFile(root + "/release/components.json", "utf8"));
  const edge = inventory.images.find((i) => i.role === "ingress");
  if (
    active.Config.Image !== edge.image ||
    active.Config.User !== "1000:1000" ||
    !active.State.Running
  )
    throw new Error();
  const reviewed = await readFile(canonical),
    supplied = await readFile(root + "/nginx/hold.routes.conf");
  if (hash(reviewed) !== hash(supplied)) throw new Error();
  for (const path of [root + "/nginx", root + "/nginx/routes.conf"]) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error();
  }
  const next = root + "/nginx/maintenance-next.conf";
  await writeFile(next, supplied, { flag: "wx", mode: 0o600 });
  await chown(next, 1000, 1000);
  // Validation uses a separate config; public routes are still untouched on failure.
  const validation = root + "/nginx/maintenance-validate.conf";
  const config = (await readFile(root + "/nginx/nginx.conf", "utf8")).replace(
    "include /etc/hambazi/routes.conf;",
    "include /etc/hambazi/maintenance-next.conf;",
  );
  await writeFile(validation, config, { mode: 0o600 });
  await chown(validation, 1000, 1000);
  await run([
    "exec",
    "hambazi-staging-platform-ingress-1",
    "nginx",
    "-t",
    "-c",
    "/etc/hambazi/maintenance-validate.conf",
  ]);
  await rename(next, root + "/nginx/routes.conf");
  await run([
    "exec",
    "hambazi-staging-platform-ingress-1",
    "nginx",
    "-s",
    "reload",
    "-c",
    "/etc/hambazi/nginx.conf",
  ]);
  console.info(
    JSON.stringify({
      event: "staging.maintenance.applied",
      checkedAt: new Date().toISOString(),
      applicationsChanged: false,
      versionRollbackAccepted: false,
    }),
  );
} catch {
  console.error("STAGING_MAINTENANCE_FAILED");
  process.exitCode = 1;
}

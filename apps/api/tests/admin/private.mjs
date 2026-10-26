import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { randomUUID } from "node:crypto";

// Root/filesystem assertions run in a networkless disposable container, never
// through sudo, SSH, a remote Docker context or a configured application DB.
const run = promisify(execFile);
const name = "hambazi-admin-private-" + randomUUID();
const environment = {
  ...process.env,
  DOCKER_HOST: "unix:///var/run/docker.sock",
  DOCKER_CONTEXT: "",
  DOCKER_TLS_VERIFY: "",
  DOCKER_CERT_PATH: "",
};
try {
  const base = JSON.parse(
    await readFile(
      new URL("../../../../infra/docker/apps/base-lock.json", import.meta.url),
      "utf8",
    ),
  );
  const modulePath = fileURLToPath(
    new URL("../../dist/composition/admin-owner-private.js", import.meta.url),
  );
  const fixture = fileURLToPath(new URL("./private-files.mjs", import.meta.url));
  await run(
    "docker",
    [
      "--host",
      "unix:///var/run/docker.sock",
      "run",
      "--rm",
      "--name",
      name,
      "--label=hambazi.purpose=disposable-admin-private-test",
      "--pull=never",
      "--network=none",
      "--read-only",
      "--user=0:0",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges:true",
      "--pids-limit=32",
      "--memory=128m",
      "--log-driver=none",
      "--tmpfs=/opt:rw,nosuid,noexec,size=4m,mode=755",
      "--tmpfs=/var/www:rw,nosuid,noexec,size=1m,mode=755",
      "--mount",
      "type=bind,src=" + modulePath + ",dst=/fixture/module.mjs,readonly",
      "--mount",
      "type=bind,src=" + fixture + ",dst=/fixture/test.mjs,readonly",
      "--entrypoint=node",
      base.image,
      "/fixture/test.mjs",
    ],
    {
      timeout: 30000,
      maxBuffer: 65536,
      env: environment,
    },
  );
  process.stdout.write("ADMIN_PRIVATE_ROOT_FILES_PASSED\n");
  await run("python3", [fileURLToPath(new URL("./private-tty.py", import.meta.url)), modulePath], {
    timeout: 15000,
    maxBuffer: 65536,
  });
  process.stdout.write("ADMIN_PRIVATE_REAL_PTY_PASSED\n");
} catch {
  process.stderr.write("ADMIN_PRIVATE_LOCAL_TEST_FAILED\n");
  process.exitCode = 1;
} finally {
  await run("docker", ["--host", "unix:///var/run/docker.sock", "rm", "--force", name], {
    env: environment,
    timeout: 10000,
  }).catch(() => {});
}

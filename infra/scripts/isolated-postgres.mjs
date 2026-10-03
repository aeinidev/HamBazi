import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
export const legacyPostgresImage =
  "postgres:18.6-bookworm@sha256:3725f4e2499eef5134592b3b4ab79a543ed7f8e533b05b5b637af926630f6650";

// Test-only: creates its own names, credentials file, bridge network and volume.
// There is no supplied existing volume/container or external database target.
export async function startIsolatedPostgres({ directory, port, credentials, legacy = false }) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("Invalid test port");
  const compose = parse(await readFile(join(root, "infra/docker/compose.yaml"), "utf8"));
  const lock = JSON.parse(
    await readFile(join(root, "infra/docker/postgres/image-lock.json"), "utf8"),
  );
  if (compose.services.postgres.image !== lock.image) throw new Error("Invalid test image");
  const name = `hambazi-image-test-${randomUUID()}`;
  let network = false,
    volume = false,
    container = false;
  let stage = "environment";
  const stop = async () => {
    if (container) {
      await run("docker", ["rm", "--force", name], { timeout: 10000 });
      container = false;
    }
    if (volume) {
      await run("docker", ["volume", "rm", name], { timeout: 10000 });
      volume = false;
    }
    if (network) {
      await run("docker", ["network", "rm", name], { timeout: 10000 });
      network = false;
    }
  };
  try {
    const values = {
      POSTGRES_USER: "hambazi_local_admin",
      POSTGRES_DB: "hambazi",
      POSTGRES_INITDB_ARGS: legacy
        ? "--locale=en_US.utf8 --encoding=UTF8"
        : compose.services.postgres.environment.POSTGRES_INITDB_ARGS,
    };
    for (const key of [
      "POSTGRES_PASSWORD",
      "POSTGRES_API_PASSWORD",
      "POSTGRES_WORKER_PASSWORD",
      "POSTGRES_MIGRATOR_PASSWORD",
    ]) {
      if (!/^[a-f0-9]{64}$/.test(credentials[key])) throw new Error("Invalid synthetic credential");
      values[key] = credentials[key];
    }
    const environment = join(directory, `${name}.env`);
    await writeFile(
      environment,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
      { flag: "wx", mode: 0o600 },
    );
    stage = "network";
    await run(
      "docker",
      [
        "network",
        "create",
        "--driver",
        "bridge",
        "--label",
        "hambazi.test=image-compatibility",
        name,
      ],
      { timeout: 10000 },
    );
    network = true;
    stage = "volume";
    await run("docker", ["volume", "create", "--label", "hambazi.test=image-compatibility", name], {
      timeout: 10000,
    });
    volume = true;
    const args = [
      "run",
      "--detach",
      "--name",
      name,
      "--label",
      "hambazi.test=image-compatibility",
      "--network",
      name,
      "--publish",
      `127.0.0.1:${port}:5432`,
      "--env-file",
      environment,
      "--volume",
      `${name}:/var/lib/postgresql`,
      "--mount",
      `type=bind,source=${join(root, "infra/docker/postgres/10-roles.sh")},target=/docker-entrypoint-initdb.d/10-roles.sh,readonly`,
    ];
    if (!legacy)
      args.push(
        "--mount",
        `type=bind,source=${join(root, "infra/docker/postgres/99-image-policy.sh")},target=/docker-entrypoint-initdb.d/99-image-policy.sh,readonly`,
        "--mount",
        `type=bind,source=${join(root, "infra/docker/postgres/start.sh")},target=/usr/local/bin/hambazi-postgres.sh,readonly`,
        "--entrypoint",
        "/bin/sh",
      );
    args.push(legacy ? legacyPostgresImage : lock.image);
    if (!legacy) args.push("/usr/local/bin/hambazi-postgres.sh");
    args.push(
      "postgres",
      "-c",
      "log_statement=none",
      "-c",
      "log_min_error_statement=panic",
      "-c",
      "log_error_verbosity=terse",
      "-c",
      "log_parameter_max_length_on_error=0",
    );
    container = true;
    stage = "container";
    await run("docker", args, { timeout: 60000, killSignal: "SIGKILL" });
    async function ready() {
      for (let i = 0; i < 120; i++) {
        try {
          await run(
            "docker",
            [
              "exec",
              name,
              "pg_isready",
              "-h",
              "127.0.0.1",
              "-U",
              values.POSTGRES_USER,
              "-d",
              values.POSTGRES_DB,
            ],
            { timeout: 2000 },
          );
          return;
        } catch {
          /* No raw container diagnostics or credentials leave this adapter. */
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("ISOLATED_POSTGRES_NOT_READY");
    }
    stage = "health";
    await ready();
    stage = "binding";
    const published = await run("docker", ["port", name, "5432/tcp"]);
    const actualPort = /^127\.0\.0\.1:(\d+)\s*$/.exec(published.stdout)?.[1];
    if (!actualPort) throw new Error("Invalid isolated binding");
    return {
      name,
      volume: name,
      port: Number(actualPort),
      stop,
      restart: async () => {
        await run("docker", ["restart", name], { timeout: 30000 });
        await ready();
      },
    };
  } catch {
    await stop();
    throw new Error(`ISOLATED_POSTGRES_START_FAILED_${stage}`);
  }
}

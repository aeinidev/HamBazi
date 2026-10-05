import { spawn, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, lstat, unlink, open } from "node:fs/promises";
import { parseEnv, promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { startLaptopProxy } from "./laptop-proxy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = join(root, ".laptop-server");
const stateFile = join(directory, "state.json");
const lockFile = join(directory, "server.lock");
const script = fileURLToPath(import.meta.url);
const execute = promisify(execFile);
const base = Object.fromEntries(
  [
    "PATH",
    "HOME",
    "PNPM_HOME",
    "TMPDIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
  ]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
const compose = [
  "compose",
  "--project-name",
  "hambazi-laptop",
  "--env-file",
  join(root, ".env"),
  "--file",
  join(root, "infra/docker/compose.yaml"),
  "--file",
  join(root, "infra/docker/laptop/compose.yaml"),
];
const wait = (ms) => new Promise((accept) => setTimeout(accept, ms));
async function command(stage, cmd, args, env = base) {
  console.info(`LAPTOP_SERVER:${stage}`);
  try {
    return await execute(cmd, args, {
      cwd: root,
      env,
      timeout: 600000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    throw new Error(`LAPTOP_SERVER_FAILED:${stage}`);
  }
}
async function privateFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.mode & 0o077)
    throw new Error("LAPTOP_SERVER_PRIVATE_FILE_REQUIRED");
  return readFile(path, "utf8");
}
async function state() {
  try {
    return JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    return undefined;
  }
}
async function ours(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return false;
  try {
    const args = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0");
    return args.includes(script) && args.includes("serve");
  } catch {
    return false;
  }
}
async function writeState(value) {
  await writeFile(
    stateFile,
    JSON.stringify({ schemaVersion: 1, pid: process.pid, ...value }) + "\n",
    { mode: 0o600 },
  );
}
async function probe(port, path = "/v1/health/ready") {
  try {
    return (await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1500) }))
      .ok;
  } catch {
    return false;
  }
}
async function serve() {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077)
    throw new Error("LAPTOP_SERVER_PRIVATE_DIRECTORY_REQUIRED");
  try {
    await writeFile(lockFile, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch {
    const previous = Number(await readFile(lockFile, "utf8"));
    if (await ours(previous)) throw new Error("LAPTOP_SERVER_ALREADY_RUNNING");
    await unlink(lockFile);
    await writeFile(lockFile, String(process.pid), { flag: "wx", mode: 0o600 });
  }
  const children = new Set();
  let proxy,
    publicUrl,
    stopping = false,
    closing,
    monitor;
  const localUrl = "http://127.0.0.1:3100";
  const close = () =>
    (closing ??= (async () => {
      stopping = true;
      clearInterval(monitor);
      const ingress = proxy?.close();
      const settled = [...children].map(
        (child) =>
          new Promise((accept) => {
            if (child.exitCode !== null || child.signalCode !== null) return accept();
            child.once("exit", accept);
            child.kill("SIGTERM");
          }),
      );
      await Promise.all([ingress, ...settled]);
      await writeState({ status: "STOPPED", localUrl });
      await unlink(lockFile).catch(() => {});
    })());
  const start = (cmd, args, env = base, tunnel = false) => {
    if (stopping) throw new Error("LAPTOP_SERVER_STOPPING");
    const child = spawn(cmd, args, {
      cwd: root,
      env,
      stdio: ["ignore", tunnel ? "pipe" : "ignore", tunnel ? "pipe" : "ignore"],
    });
    children.add(child);
    child.on("error", () => {
      void close();
    });
    child.on("exit", () => {
      children.delete(child);
      if (!stopping) {
        console.error("LAPTOP_SERVER_CHILD_STOPPED");
        void close();
      }
    });
    return child;
  };
  process.once("SIGTERM", () => {
    void close();
  });
  process.once("SIGINT", () => {
    void close();
  });
  try {
    await writeState({ status: "STARTING", localUrl });
    const env = parseEnv(await privateFile(join(root, ".env")));
    for (const field of [
      "API_DATABASE_URL",
      "WORKER_DATABASE_URL",
      "MIGRATION_DATABASE_URL",
      "API_REDIS_URL",
      "WORKER_REDIS_URL",
    ]) {
      const url = new URL(env[field]);
      if (!["localhost", "127.0.0.1"].includes(url.hostname))
        throw new Error("LAPTOP_SERVER_LOCAL_DATA_REQUIRED");
      url.hostname = "127.0.0.1";
      env[field] = url.toString();
    }
    if (!/^\d{1,20}:[A-Za-z0-9_-]{20,200}$/.test(env.TELEGRAM_BOT_TOKEN ?? ""))
      throw new Error("LAPTOP_SERVER_BOT_TOKEN_REQUIRED_IN_ENV");
    // No token is copied into the browser or status file. Session material survives restarts.
    const keyFile = join(directory, "session-key");
    try {
      await writeFile(keyFile, randomBytes(32).toString("base64url"), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const signing = (await privateFile(keyFile)).trim();
    await command("data-config", "docker", [...compose, "config", "--quiet"]);
    await command("data-start", "docker", [
      ...compose,
      "up",
      "--detach",
      "--wait",
      "--wait-timeout",
      "90",
    ]);
    await command("backend-build", "pnpm", [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=@hambazi/api",
      "--filter=@hambazi/worker",
    ]);
    await command("database-migrate", "pnpm", ["--filter", "@hambazi/database", "db:migrate"], {
      ...base,
      MIGRATION_DATABASE_URL: env.MIGRATION_DATABASE_URL,
    });
    proxy = await startLaptopProxy({
      port: 3100,
      apiPort: Number(env.API_PORT),
      webPort: 3101,
      origin: () => publicUrl,
    });
    {
      console.info("LAPTOP_SERVER:tunnel-start");
      const args = [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=15",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        `UserKnownHostsFile=${join(directory, "known_hosts")}`,
        "-o",
        "IdentityAgent=none",
        "-o",
        "IdentityFile=none",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "ServerAliveInterval=30",
        "-o",
        "ServerAliveCountMax=3",
      ];
      if (base.HTTPS_PROXY || base.HTTP_PROXY) {
        const url = new URL(base.HTTPS_PROXY || base.HTTP_PROXY);
        if (
          url.protocol !== "http:" ||
          !["127.0.0.1", "localhost"].includes(url.hostname) ||
          url.username ||
          url.password
        )
          throw new Error("LAPTOP_SERVER_LOCAL_PROXY_REQUIRED");
        args.push(
          "-o",
          `ProxyCommand=nc -X connect -x ${url.hostname}:${Number(url.port) || 80} %h %p`,
        );
      }
      args.push("-R", "80:127.0.0.1:3100", "nokey@localhost.run");
      const tunnel = start("ssh", args, base, true);
      publicUrl = await new Promise((accept, reject) => {
        const timer = setTimeout(() => reject(new Error("LAPTOP_SERVER_TUNNEL_TIMEOUT")), 60000);
        let text = "";
        tunnel.stdout.on("data", (chunk) => {
          text = (text + chunk.toString()).slice(-16384);
          const match = text.match(/https:\/\/[a-z0-9-]+\.(?:lhr\.life|localhost\.run)/);
          if (match) {
            clearTimeout(timer);
            accept(match[0]);
          }
        });
        tunnel.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("LAPTOP_SERVER_TUNNEL_FAILED"));
        });
        tunnel.once("error", () => {
          clearTimeout(timer);
          reject(new Error("LAPTOP_SERVER_TUNNEL_FAILED"));
        });
      });
      // Ignore diagnostics; keep the pipe drained without persisting request data.
      tunnel.stderr.on("data", () => {});
    }
    const origin = publicUrl;
    await command("web-build", "pnpm", ["exec", "turbo", "run", "build", "--filter=@hambazi/web"], {
      ...base,
      VITE_API_ORIGIN: "",
      HAMBAZI_WEB_ORIGIN: origin,
      HAMBAZI_WEB_FRAME_ANCESTORS: "[]",
      HAMBAZI_WEB_POLICY_PROFILE: "production",
    });
    const api = {
      ...base,
      NODE_ENV: "development",
      API_PORT: env.API_PORT,
      API_DATABASE_URL: env.API_DATABASE_URL,
      API_REDIS_URL: env.API_REDIS_URL,
      ALLOWED_ORIGINS: `${localUrl}${publicUrl ? `,${publicUrl}` : ""}`,
      TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
      API_BIND_ADDRESS: "127.0.0.1",
      API_TRUSTED_PROXIES: "127.0.0.1",
      API_DB_POOL_MAX: "5",
      API_HEALTH_PORT: "3103",
      API_METRICS_ENABLED: "true",
      AUTH_SESSION_SECONDS: "900",
      AUTH_TELEGRAM_MAX_AGE_SECONDS: "300",
      AUTH_TELEGRAM_FUTURE_SKEW_SECONDS: "30",
      AUTH_IP_LIMIT: "30",
      AUTH_IDENTITY_LIMIT: "6",
      AUTH_ACTIVE_KEY_ID: "laptop",
      AUTH_ISSUER: "hambazi:laptop",
      AUTH_AUDIENCE: "hambazi-laptop",
      AUTH_SIGNING_KEYS: JSON.stringify([{ id: "laptop", secret: signing }]),
      PROFILE_READ_LIMIT: "120",
      PROFILE_WRITE_LIMIT: "20",
      CATALOG_READ_LIMIT: "120",
      ADMISSION_HTTP_PER_MINUTE: "120",
      ADMISSION_ENGINE_PER_MINUTE: "120",
      ADMISSION_CONNECT_PER_MINUTE: "30",
      ADMISSION_EVENT_PER_MINUTE: "120",
      ADMISSION_HTTP_IN_FLIGHT: "32",
      ADMISSION_ENGINE_IN_FLIGHT: "32",
      ADMISSION_CONNECTIONS: "64",
      ADMISSION_PENDING_PER_SOCKET: "8",
      ADMISSION_PENDING_TOTAL: "64",
      ADMISSION_SUBSCRIPTIONS: "8",
    };
    const worker = {
      ...base,
      NODE_ENV: "development",
      WORKER_DATABASE_URL: env.WORKER_DATABASE_URL,
      WORKER_REDIS_URL: env.WORKER_REDIS_URL,
      WORKER_QUEUE_NAMESPACE: "laptop",
      BOT_CLEANUP_INTERVAL_MS: "60000",
      BOT_CLEANUP_BATCH_SIZE: "100",
      BOT_CLEANUP_ATTEMPTS: "3",
      BOT_CLEANUP_BACKOFF_MS: "1000",
      WORKER_DB_POOL_MAX: "3",
      WORKER_HEALTH_PORT: "3104",
      WORKER_METRICS_ENABLED: "true",
    };
    for (const [role, config] of [
      ["api", api],
      ["worker", worker],
    ]) {
      const manifest = JSON.parse(await readFile(join(root, "apps", role, "package.json"), "utf8"));
      const entry = /^node (dist\/[A-Za-z0-9/_.-]+\.js)$/.exec(manifest.scripts.start)?.[1];
      if (!entry) throw new Error("LAPTOP_SERVER_START_SCRIPT_UNSUPPORTED");
      start(process.execPath, [join(root, "apps", role, entry)], config);
    }
    // Existing immutable static server intentionally accepts only production browser artifacts.
    start(process.execPath, [join(root, "apps/web/server/serve.mjs")], {
      ...base,
      NODE_ENV: "production",
      WEB_BIND_ADDRESS: "127.0.0.1",
      WEB_PORT: "3101",
      WEB_HEALTH_PORT: "3102",
    });
    let healthy = false;
    for (let n = 0; n < 60 && !stopping; n++) {
      const checks = await Promise.all([probe(3102), probe(3103), probe(3104)]);
      if (checks.every(Boolean)) {
        healthy = true;
        break;
      }
      await wait(500);
    }
    if (!healthy || stopping) throw new Error("LAPTOP_SERVER_READINESS_FAILED");
    proxy.ready();
    const publicSmoke = await command("public-smoke", "curl", [
      "--silent",
      "--show-error",
      "--output",
      "/dev/null",
      "--write-out",
      "%{http_code}",
      "--max-time",
      "20",
      publicUrl,
    ]);
    if (publicSmoke.stdout.trim() !== "200") throw new Error("LAPTOP_SERVER_PUBLIC_UNREACHABLE");
    await writeState({
      status: "READY",
      localUrl,
      publicUrl,
      publicVerified: true,
      capabilities: ["auth", "profile", "catalog"],
      gameplayEnabled: false,
    });
    console.info(`LAPTOP_SERVER_READY ${publicUrl}`);
    let checking = false;
    monitor = setInterval(async () => {
      if (stopping || checking) return;
      checking = true;
      try {
        const checks = await Promise.all([probe(3102), probe(3103), probe(3104)]);
        let publicVerified = false;
        try {
          const result = await execute(
            "curl",
            [
              "--silent",
              "--output",
              "/dev/null",
              "--write-out",
              "%{http_code}",
              "--max-time",
              "5",
              publicUrl,
            ],
            { env: base, timeout: 7000 },
          );
          publicVerified = result.stdout.trim() === "200";
        } catch {
          /* Connectivity loss is reported without raw diagnostics. */
        }
        if (!stopping)
          await writeState({
            status: checks.every(Boolean) && publicVerified ? "READY" : "DEGRADED",
            localUrl,
            publicUrl,
            publicVerified,
            gameplayEnabled: false,
          });
      } finally {
        checking = false;
      }
    }, 30000);
    monitor.unref();
  } catch (error) {
    console.error(
      /^LAPTOP_SERVER_[A-Z_]+(?::[a-z-]+)?$/.test(error.message)
        ? error.message
        : "LAPTOP_SERVER_START_FAILED",
    );
    await close();
    await writeState({
      status: "FAILED",
      localUrl,
      errorCode: /^LAPTOP_SERVER_[A-Z_]+(?::[a-z-]+)?$/.test(error.message)
        ? error.message
        : "LAPTOP_SERVER_START_FAILED",
    });
    process.exitCode = 1;
  }
}

const action = process.argv[2];
try {
  if (action === "serve") await serve();
  else if (action === "start") {
    if (await ours((await state())?.pid)) throw new Error("LAPTOP_SERVER_ALREADY_RUNNING");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077)
      throw new Error("LAPTOP_SERVER_PRIVATE_DIRECTORY_REQUIRED");
    const log = await open(join(directory, "server.log"), "a", 0o600);
    const child = spawn(process.execPath, [script, "serve"], {
      cwd: root,
      env: base,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    await new Promise((accept, reject) => {
      child.once("spawn", accept);
      child.once("error", reject);
    });
    child.unref();
    await log.close();
    console.info("LAPTOP_SERVER_STARTING: run pnpm laptop:status for readiness and URLs.");
  } else if (action === "status") {
    const current = await state();
    console.info(
      JSON.stringify(
        current && ((await ours(current.pid)) || current.status === "FAILED")
          ? current
          : { status: "STOPPED" },
        null,
        2,
      ),
    );
  } else if (action === "stop") {
    const current = await state();
    if (await ours(current?.pid)) {
      process.kill(current.pid, "SIGTERM");
      for (let n = 0; n < 80 && (await ours(current.pid)); n++) await wait(500);
      if (await ours(current.pid)) throw new Error("LAPTOP_SERVER_DRAIN_TIMEOUT");
    }
    await command("data-stop", "docker", [...compose, "stop"]);
    console.info("LAPTOP_SERVER_STOPPED: database volume retained.");
  } else throw new Error("LAPTOP_SERVER_USE_START_STATUS_OR_STOP");
} catch (error) {
  console.error(
    /^LAPTOP_SERVER_[A-Z_]+(?::[a-z-]+)?$/.test(error.message)
      ? error.message
      : "LAPTOP_SERVER_COMMAND_FAILED",
  );
  process.exitCode = 1;
}

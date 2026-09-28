import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createLocalEnvironment } from "../scripts/create-local-env.mjs";

const directories = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "hambazi-infra-test-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("local credentials", () => {
  it("generates private, unique credentials and matching role URLs", async () => {
    const path = await directory();
    await createLocalEnvironment(path);
    const raw = await readFile(join(path, ".env"), "utf8");
    const env = parseEnv(raw);
    expect((await stat(join(path, ".env"))).mode & 0o777).toBe(0o600);
    const passwords = Object.entries(env)
      .filter(([key]) => key.endsWith("PASSWORD"))
      .map(([, value]) => value);
    expect(passwords).toHaveLength(7);
    expect(new Set(passwords).size).toBe(7);
    expect(passwords.every((value) => /^[a-f0-9]{64}$/.test(value))).toBe(true);
    expect(raw.includes("REPLACE_")).toBe(false);
    for (const [urlKey, passwordKey, username] of [
      ["API_DATABASE_URL", "POSTGRES_API_PASSWORD", "hambazi_api"],
      ["WORKER_DATABASE_URL", "POSTGRES_WORKER_PASSWORD", "hambazi_worker"],
      ["MIGRATION_DATABASE_URL", "POSTGRES_MIGRATOR_PASSWORD", "hambazi_migrator"],
      ["API_REDIS_URL", "REDIS_API_PASSWORD", "api"],
      ["WORKER_REDIS_URL", "REDIS_WORKER_PASSWORD", "worker"],
    ]) {
      const url = new URL(env[urlKey]);
      expect(url.password === env[passwordKey]).toBe(true);
      expect(url.username).toBe(username);
    }
    await expect(createLocalEnvironment(path)).rejects.toMatchObject({ code: "EEXIST" });
    expect((await readFile(join(path, ".env"), "utf8")) === raw).toBe(true);
  });

  it("refuses to overwrite a symlink target", async () => {
    const path = await directory();
    const target = join(path, "existing");
    await writeFile(target, "preserve");
    await symlink(target, join(path, ".env"));
    await expect(createLocalEnvironment(path)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(target, "utf8")).toBe("preserve");
  });

  it("CLI reports success/failure without printing credentials", async () => {
    const path = await directory();
    const script = fileURLToPath(new URL("../scripts/create-local-env.mjs", import.meta.url));
    const first = spawnSync(process.execPath, [script], { cwd: path, encoding: "utf8" });
    const second = spawnSync(process.execPath, [script], { cwd: path, encoding: "utf8" });
    expect(first.status).toBe(0);
    expect(second.status).toBe(1);
    const output = first.stdout + first.stderr + second.stdout + second.stderr;
    const env = parseEnv(await readFile(join(path, ".env"), "utf8"));
    expect(
      Object.entries(env)
        .filter(([key]) => key.endsWith("PASSWORD"))
        .every(([, value]) => !output.includes(value)),
    ).toBe(true);
  });
});

describe("local service definition", () => {
  it("pins images, restricts published ports, and keeps the network internal", async () => {
    const compose = parse(
      await readFile(new URL("../docker/compose.yaml", import.meta.url), "utf8"),
    );
    expect(Object.keys(compose.services).sort()).toEqual(["postgres", "redis"]);
    expect(compose.networks.private.internal).toBe(true);
    for (const service of Object.values(compose.services)) {
      expect(service.image).toMatch(/@sha256:[a-f0-9]{64}$/);
      expect(service.ports.every((port) => port.host_ip === "127.0.0.1")).toBe(true);
      expect(service.networks).toEqual(["private"]);
      expect(service.healthcheck.test[0]).toBe("CMD-SHELL");
      for (const [key, value] of Object.entries(service.environment)) {
        if (key.endsWith("PASSWORD")) expect(value).toContain(`\${${key}:?`);
      }
    }
    expect(compose.services.postgres.volumes).toContain("postgres-data:/var/lib/postgresql");
    expect(compose.services.redis.volumes.every((volume) => volume.endsWith(":ro"))).toBe(true);
    expect(compose.services.redis.tmpfs).toContain("/data:mode=1777");
    expect(compose.services.redis.user).toBe("redis");
  });

  it.each(["postgres/10-roles.sh", "redis/start.sh"])(
    "has valid POSIX shell syntax: %s",
    (file) => {
      const path = fileURLToPath(new URL(`../docker/${file}`, import.meta.url));
      expect(spawnSync("sh", ["-n", path], { encoding: "utf8" }).status).toBe(0);
    },
  );

  it("does not grant DDL to runtime roles or Redis admin/unscoped access", async () => {
    const postgres = await readFile(
      new URL("../docker/postgres/10-roles.sh", import.meta.url),
      "utf8",
    );
    const redis = await readFile(new URL("../docker/redis/start.sh", import.meta.url), "utf8");
    expect(postgres.match(/LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE/g)).toHaveLength(3);
    expect(postgres).toContain("REVOKE ALL ON SCHEMA public FROM PUBLIC");
    expect(postgres).toContain("GRANT USAGE, CREATE ON SCHEMA public TO hambazi_migrator");
    expect(postgres).not.toMatch(/GRANT.*CREATE.*TO hambazi_(api|worker)/);
    expect(redis).toContain("user default off");
    expect(redis.match(/~hambazi:\* &hambazi:\*/g)).toHaveLength(2);
    expect(redis.match(/-@dangerous/g)).toHaveLength(2);
    expect(redis).toContain("-@dangerous +info +time\\nuser worker");
    expect(redis.match(/\+time/g)).toHaveLength(1);
    expect(redis).toContain("--appendonly no --maxmemory-policy noeviction");
    expect(redis).toContain("--save ''");
  });
});

import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ run: vi.fn(), filesystem: vi.fn(), uuid: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: Object.assign(() => {}, { [Symbol.for("nodejs.util.promisify.custom")]: deps.run }),
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original()),
  statfs: deps.filesystem,
}));
vi.mock("node:crypto", async (original) => ({ ...(await original()), randomUUID: deps.uuid }));
const { startIsolatedPostgres } = await import("../scripts/isolated-postgres.mjs");
const credentials = Object.fromEntries(
  [
    "POSTGRES_PASSWORD",
    "POSTGRES_API_PASSWORD",
    "POSTGRES_WORKER_PASSWORD",
    "POSTGRES_MIGRATOR_PASSWORD",
  ].map((key) => [key, "1".repeat(64)]),
);
let directory;
const commands = () => deps.run.mock.calls.map(([, args]) => args);
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "hambazi-storage-unit-"));
  deps.uuid.mockReset().mockReturnValue("owned-unit");
  deps.filesystem.mockReset().mockResolvedValue({ type: 0xef53 });
  deps.run.mockReset().mockImplementation(async (_, args) => ({
    stdout: args[0] === "port" ? "127.0.0.1:54321\n" : "",
  }));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("keeps durable disk data through restart and cleans only its own stopped fixture", async () => {
  const pg = await startIsolatedPostgres({ directory, port: 0, credentials });
  const startup = commands().find((args) => args.includes("--detach"));
  expect(startup).toContain(`type=bind,source=${pg.dataDirectory},target=/var/lib/postgresql`);
  for (const setting of ["fsync=on", "synchronous_commit=on", "full_page_writes=on"])
    expect(startup).toContain(setting);
  expect(startup).toContain("127.0.0.1:0:5432");
  await pg.restart();
  expect((await lstat(pg.dataDirectory)).isDirectory()).toBe(true);
  await pg.stop();
  const calls = commands();
  const stop = calls.findIndex((args) => args[0] === "rm");
  const cleanup = calls.findIndex((args) => args.includes("find"));
  expect(cleanup).toBeGreaterThan(stop);
  expect(calls[cleanup]).toEqual(
    expect.arrayContaining([
      "--read-only",
      "none",
      `type=bind,source=${pg.dataDirectory},target=/owned`,
      "find",
      "/owned",
      "-mindepth",
      "1",
      "-delete",
    ]),
  );
  expect(calls.some((args) => args[0] === "volume")).toBe(false);
  expect(calls.find((args) => args.includes("chown"))).toEqual(
    expect.arrayContaining([
      `type=bind,source=${pg.dataDirectory},target=/owned`,
      "postgres:postgres",
      "/owned",
    ]),
  );
  await expect(lstat(pg.dataDirectory)).rejects.toMatchObject({ code: "ENOENT" });
});

for (const type of [0x01021994, 0x858458f6])
  it(`rejects memory filesystem ${type} before starting Docker`, async () => {
    deps.filesystem.mockResolvedValue({ type });
    await expect(startIsolatedPostgres({ directory, port: 0, credentials })).rejects.toThrow();
    expect(deps.run).not.toHaveBeenCalled();
  });

it("rejects public or symlinked directories", async () => {
  await chmod(directory, 0o755);
  await expect(startIsolatedPostgres({ directory, port: 0, credentials })).rejects.toThrow();
  await chmod(directory, 0o700);
  await symlink(directory, join(directory, "alias"));
  await expect(
    startIsolatedPostgres({ directory: join(directory, "alias"), port: 0, credentials }),
  ).rejects.toThrow();
  expect(deps.run).not.toHaveBeenCalled();
});

it("does not reuse or erase existing data", async () => {
  const data = join(directory, "hambazi-image-test-owned-unit.data");
  await mkdir(data, { mode: 0o700 });
  await writeFile(join(data, "sentinel"), "preserve");
  await expect(startIsolatedPostgres({ directory, port: 0, credentials })).rejects.toThrow();
  expect(await readFile(join(data, "sentinel"), "utf8")).toBe("preserve");
  expect(deps.run).not.toHaveBeenCalled();
});

it("supports legacy and current clusters in the same private parent", async () => {
  deps.uuid.mockReturnValueOnce("legacy").mockReturnValueOnce("current");
  const first = await startIsolatedPostgres({ directory, port: 0, credentials, legacy: true });
  const second = await startIsolatedPostgres({ directory, port: 0, credentials });
  expect(first.dataDirectory).not.toBe(second.dataDirectory);
  await first.stop();
  expect((await lstat(second.dataDirectory)).isDirectory()).toBe(true);
  await second.stop();
});

it("preserves data if stopping its container fails", async () => {
  const pg = await startIsolatedPostgres({ directory, port: 0, credentials });
  deps.run.mockRejectedValueOnce(new Error("owned stop failed"));
  await expect(pg.stop()).rejects.toThrow("owned stop failed");
  expect((await lstat(pg.dataDirectory)).isDirectory()).toBe(true);
  expect(commands().some((args) => args.includes("find"))).toBe(false);
  await pg.stop();
});

import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

// Run the actual release CLIs against disposable copies, never mutate reviewed baselines.
const run = promisify(execFile);
const api = fileURLToPath(new URL("../../", import.meta.url));
const contracts = fileURLToPath(new URL("../../../../docs/contracts/", import.meta.url));
let directory;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "hambazi-contract-release-"));
  await mkdir(join(directory, "apps/api"), { recursive: true });
  await mkdir(join(directory, "docs"));
  await writeFile(join(directory, "package.json"), '{"type":"module"}');
  await cp(join(api, "scripts"), join(directory, "apps/api/scripts"), { recursive: true });
  await symlink(join(api, "dist"), join(directory, "apps/api/dist"), "dir");
  await symlink(join(api, "node_modules"), join(directory, "apps/api/node_modules"), "dir");
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function reset() {
  await cp(contracts, join(directory, "docs/contracts"), { recursive: true, force: true });
}
async function change(name, mutate) {
  const path = join(directory, "docs/contracts", name);
  const document = JSON.parse(await readFile(path, "utf8"));
  mutate(document);
  await writeFile(path, JSON.stringify(document));
}
async function exitCode(script, args = []) {
  try {
    await run(process.execPath, [join(directory, "apps/api/scripts", script), ...args], {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    return 0;
  } catch (error) {
    // Fixed numeric status only; no arbitrary child error/output reaches assertions.
    return typeof error.code === "number" ? error.code : -1;
  }
}
const documents = [
  ["auth", "auth-contract.mjs"],
  ["bot-internal", "bot-contract.mjs"],
  ["health", "bot-contract.mjs"],
  ["profile", "profile-contract.mjs"],
  ["catalog", "catalog-contract.mjs"],
  ["rooms", "rooms-contract.mjs"],
  ["statistics", "statistics-contract.mjs"],
];
for (const [name, script] of documents) {
  it(`checks and regenerates the reviewed ${name} contract with the actual CLI`, async () => {
    await reset();
    expect(await exitCode(script)).toBe(0);
    expect(await exitCode(script, ["--write"])).toBe(0);
    expect(await exitCode(script)).toBe(0);
  });
  it(`rejects ${name} wire drift without allowing regeneration to bless it`, async () => {
    await reset();
    await change(`${name}.v1.baseline.json`, (document) => {
      const operation = Object.values(Object.values(document.paths)[0])[0];
      operation.security = [{ unapprovedReleaseAuthority: [] }];
    });
    expect(await exitCode(script)).toBe(1);
    const before = await readFile(join(directory, `docs/contracts/${name}.openapi.json`), "utf8");
    expect(await exitCode(script, ["--write"])).toBe(1);
    expect(await readFile(join(directory, `docs/contracts/${name}.openapi.json`), "utf8")).toBe(
      before,
    );
  });
  it(`rejects stale ${name} generated output and repairs only its disposable copy`, async () => {
    await reset();
    await change(`${name}.openapi.json`, (document) => {
      document.info.title = "Stale artifact";
    });
    expect(await exitCode(script)).toBe(1);
    expect(await exitCode(script, ["--write"])).toBe(0);
    expect(await exitCode(script)).toBe(0);
  });
}
it("checks and regenerates the reviewed realtime catalog with the actual CLI", async () => {
  await reset();
  expect(await exitCode("realtime-contract.mjs")).toBe(0);
  expect(await exitCode("realtime-contract.mjs", ["--write"])).toBe(0);
  expect(await exitCode("realtime-contract.mjs")).toBe(0);
});
for (const [name, field] of [
  ["realtime.v1.baseline.json", "handshake"],
  ["realtime.delivery.v1.baseline.json", "catchupResult"],
  ["realtime.chat.v1.baseline.json", "message"],
]) {
  it(`rejects breaking ${field} catalog semantics in check and generation`, async () => {
    await reset();
    await change(name, (document) => {
      document[field] = { unapproved: true };
    });
    expect(await exitCode("realtime-contract.mjs")).toBe(1);
    expect(await exitCode("realtime-contract.mjs", ["--write"])).toBe(1);
  });
}
it("rejects stale realtime output without rewriting a reviewed baseline", async () => {
  await reset();
  await change("realtime.events.json", (document) => {
    document.namespace = "/unapproved";
  });
  expect(await exitCode("realtime-contract.mjs")).toBe(1);
  expect(await exitCode("realtime-contract.mjs", ["--write"])).toBe(0);
  expect(await exitCode("realtime-contract.mjs")).toBe(0);
});

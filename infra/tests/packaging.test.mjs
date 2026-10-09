import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { startStaticWeb } from "../../apps/web/server/serve.mjs";
import { createBrowserPolicy } from "../../apps/web/security/browser-policy.ts";
import { telegramSdkIntegrity } from "../../apps/web/src/platform/telegram-sdk.ts";
import { hashContext, verifyArchive, buildIdentity } from "../release/build.mjs";
import { assessImage } from "../scripts/security-scan.mjs";
import { projectScan } from "../ci/scan-evidence.mjs";
import { runSequence } from "../ci/gates.mjs";

const directories = [],
  servers = [];
it("refuses substituted runtime package archives before Docker builds", () => {
  expect(() => verifyArchive(Buffer.from("synthetic substitution"), "0".repeat(64))).toThrow(
    "PACKAGING_INPUT_INVALID",
  );
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-static-test-"));
  directories.push(directory);
  const policy = createBrowserPolicy(
    { profile: "production", webOrigin: null, apiOrigin: null, frameAncestors: [] },
    telegramSdkIntegrity,
  );
  await writeFile(join(directory, "security-headers.json"), JSON.stringify(policy));
  await writeFile(join(directory, "index.html"), "<!doctype html><title>Static fixture</title>");
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "assets/app.js"), "/* synthetic public asset */");
  async function port() {
    const reservation = createServer();
    await new Promise((accept) => reservation.listen(0, "127.0.0.1", accept));
    const selected = reservation.address().port;
    await new Promise((accept) => reservation.close(accept));
    return String(selected);
  }
  return {
    directory,
    policy,
    environment: {
      NODE_ENV: "production",
      WEB_BIND_ADDRESS: "127.0.0.1",
      WEB_PORT: await port(),
      WEB_HEALTH_PORT: await port(),
    },
  };
}
it("serves immutable assets with the reviewed CSP, no-store, MIME and HEAD semantics", async () => {
  const { directory, policy, environment } = await fixture();
  servers.push(await startStaticWeb(environment, directory));
  const origin = `http://127.0.0.1:${environment.WEB_PORT}`;
  const response = await fetch(origin);
  expect(response.status).toBe(200);
  for (const [name, value] of Object.entries(policy.headers))
    expect(response.headers.get(name)).toBe(value);
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(await response.text()).toContain("Static fixture");
  const head = await fetch(origin + "/assets/app.js", { method: "HEAD" });
  expect(head.headers.get("content-type")).toContain("text/javascript");
  expect(await head.text()).toBe("");
  const health = await fetch(`http://127.0.0.1:${environment.WEB_HEALTH_PORT}/v1/health/ready`);
  expect(await health.json()).toEqual({ schemaVersion: 1, status: "READY" });
  expect((await fetch(origin + "/v1/health/ready")).status).toBe(404);
});
it("rejects traversal, private/unknown assets and non-read methods without echoing input", async () => {
  const { directory, environment } = await fixture();
  servers.push(await startStaticWeb(environment, directory));
  const origin = `http://127.0.0.1:${environment.WEB_PORT}`;
  for (const path of [
    "/%2e%2e%2fprivate",
    "/%5cprivate",
    "/%00",
    "/.env",
    "/server/serve.mjs",
    "/missing.js",
  ]) {
    const response = await fetch(origin + path);
    expect([400, 404]).toContain(response.status);
    expect(await response.text()).not.toContain("private");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  }
  expect((await fetch(origin, { method: "POST", body: "synthetic" })).status).toBe(405);
});
it("refuses changed browser policy, test profile and invalid bind/ports before listening", async () => {
  const { directory, policy, environment } = await fixture();
  for (const patch of [
    { NODE_ENV: "test" },
    { WEB_BIND_ADDRESS: "203.0.113.1" },
    { WEB_PORT: "80" },
    { WEB_HEALTH_PORT: environment.WEB_PORT },
  ])
    await expect(startStaticWeb({ ...environment, ...patch }, directory)).rejects.toThrow(
      "WEB_STATIC_CONFIGURATION_INVALID",
    );
  await writeFile(
    join(directory, "security-headers.json"),
    JSON.stringify({
      ...policy,
      headers: { ...policy.headers, "Content-Security-Policy": "script-src *" },
    }),
  );
  await expect(startStaticWeb(environment, directory)).rejects.toThrow(
    "INVALID_WEB_BROWSER_POLICY",
  );
  const testPolicy = createBrowserPolicy(
    {
      profile: "loopback-test",
      webOrigin: "http://127.0.0.1:4173",
      apiOrigin: null,
      frameAncestors: [],
    },
    telegramSdkIntegrity,
  );
  await writeFile(join(directory, "security-headers.json"), JSON.stringify(testPolicy));
  await expect(startStaticWeb(environment, directory)).rejects.toThrow(
    "WEB_STATIC_CONFIGURATION_INVALID",
  );
});
it("refuses symlink assets and source-map exposure, and closes idempotently", async () => {
  const { directory, environment } = await fixture();
  await symlink(join(directory, "index.html"), join(directory, "alias.html"));
  await expect(startStaticWeb(environment, directory)).rejects.toThrow(
    "WEB_STATIC_CONFIGURATION_INVALID",
  );
  await rm(join(directory, "alias.html"));
  await writeFile(join(directory, "assets/private.js.map"), "{}");
  await expect(startStaticWeb(environment, directory)).rejects.toThrow(
    "WEB_STATIC_CONFIGURATION_INVALID",
  );
  await rm(join(directory, "assets/private.js.map"));
  const server = await startStaticWeb(environment, directory);
  await Promise.all([server.close(), server.close()]);
});
it("binds packaging snapshots to file bytes and rejects symlinks", async () => {
  const { directory } = await fixture();
  const first = await hashContext(directory);
  await writeFile(join(directory, "index.html"), "changed");
  expect((await hashContext(directory)).sha256).not.toBe(first.sha256);
  await symlink(join(directory, "index.html"), join(directory, "alias.html"));
  await expect(hashContext(directory)).rejects.toThrow("PACKAGING_INPUT_INVALID");
});
it("binds image identity to both source and public browser policy", () => {
  const source = "a".repeat(64);
  expect(buildIdentity(source, { apiOrigin: null })).not.toBe(
    buildIdentity(source, { apiOrigin: "https://api.example" }),
  );
  expect(buildIdentity(source, { apiOrigin: null })).not.toBe(
    buildIdentity("b".repeat(64), { apiOrigin: null }),
  );
});
it("rejects incomplete, reordered or unsafe application-image CI evidence", () => {
  const counts = { info: 0, unknown: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  const report = {
    schemaVersion: 1,
    kind: "application-images",
    status: "passed",
    ok: true,
    sourceCommit: "a".repeat(40),
    sourceDirty: false,
    sourceSnapshotSha256: "b".repeat(64),
    buildInputSha256: "d".repeat(64),
    database: { updatedAt: new Date().toISOString(), downloadedAt: new Date().toISOString() },
    images: ["api", "bot", "worker", "web"].map((role) => ({
      role,
      image: `hambazi-candidate/${role}:${"a".repeat(40)}-${"b".repeat(16)}@sha256:${"c".repeat(64)}`,
      counts,
      findings: [],
    })),
  };
  expect(projectScan(report, "application-images").images).toHaveLength(4);
  for (const patch of [
    { images: report.images.slice(0, 3) },
    { images: [...report.images].reverse() },
    { sourceCommit: "unbound" },
    { buildInputSha256: undefined },
    { images: report.images.map((image) => ({ ...image, counts: { ...counts, high: 1 } })) },
  ])
    expect(() => projectScan({ ...report, ...patch }, "application-images")).toThrow();
});
it("exports only verified numeric application smoke evidence and rejects a false release claim", async () => {
  const report = {
    schemaVersion: 1,
    purpose: "disposable-packaging-smoke",
    passed: true,
    productionReady: false,
    checks: 43,
    browserCases: 2,
    privateField: "synthetic-private-canary",
  };
  const gate = (value) => ({
    stage: "application-image-smoke",
    command: process.execPath,
    args: ["--eval", `process.stdout.write(${JSON.stringify(JSON.stringify(value))})`],
  });
  const evidence = await runSequence([gate(report)]);
  expect(evidence[0].runtimeChecks).toBe(43);
  expect(evidence[0].browserCases).toBe(2);
  expect(JSON.stringify(evidence)).not.toContain(report.privateField);
  await expect(runSequence([gate({ ...report, productionReady: true })])).rejects.toThrow(
    "CI_GATE_FAILED:application-image-smoke",
  );
});
it("keeps unknown/high/unfixed image findings blocking for the exact candidate inventory", () => {
  const image = `hambazi-candidate/api:${"a".repeat(40)}-${"b".repeat(16)}@sha256:${"c".repeat(64)}`;
  const report = {
    SchemaVersion: 2,
    ArtifactType: "container_image",
    ArtifactName: image,
    Results: [
      {
        Class: "os-pkgs",
        Vulnerabilities: [
          { Severity: "HIGH", VulnerabilityID: "CVE-2026-12345", PkgName: "synthetic" },
        ],
      },
    ],
  };
  expect(assessImage(report, image).ok).toBe(false);
  expect(
    assessImage(
      {
        ...report,
        Results: [
          {
            Class: "os-pkgs",
            Vulnerabilities: [
              { Severity: "UNKNOWN", VulnerabilityID: "CVE-2026-12345", PkgName: "synthetic" },
            ],
          },
        ],
      },
      image,
    ).ok,
  ).toBe(false);
  expect(() => assessImage(report, image.replace("api:", "unreviewed:"))).toThrow();
});
it("runtime packages explicitly include compiled exports while omitting tests and source", async () => {
  for (const path of [
    "apps/api",
    "apps/bot",
    "apps/worker",
    "packages/database",
    "packages/config",
    "packages/contracts",
    "packages/game-core",
    "packages/games/coup-engine",
    "packages/observability",
    "packages/shared",
    "packages/validation",
  ])
    expect(
      JSON.parse(await readFile(new URL(`../../${path}/package.json`, import.meta.url), "utf8"))
        .files,
    ).toEqual(path === "apps/bot" ? ["dist", "assets"] : ["dist"]);
});

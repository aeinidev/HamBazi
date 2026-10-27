import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { startStaticWeb } from "../../apps/web/server/serve.mjs";
import { createBrowserPolicy } from "../../apps/web/security/browser-policy.ts";
import { telegramSdkIntegrity } from "../../apps/web/src/platform/telegram-sdk.ts";
import {
  hashContext,
  verifyArchive,
  buildIdentity,
  kahrobaBuildFeatures,
  localBuildTransport,
} from "../release/build.mjs";
import { assessImage } from "../scripts/security-scan.mjs";
import { projectScan } from "../ci/scan-evidence.mjs";
import { runSequence } from "../ci/gates.mjs";

const directories = [],
  servers = [];
it("keeps the security-patched Node version consistent across CI, build and runtime images", async () => {
  const pin = JSON.parse(await readFile(new URL("../ci/toolchain.json", import.meta.url), "utf8"));
  const base = JSON.parse(
    await readFile(new URL("../docker/apps/base-lock.json", import.meta.url), "utf8"),
  );
  const dockerfile = await readFile(new URL("../docker/apps/Dockerfile", import.meta.url), "utf8");
  expect(pin.nodeVersion).toBe("24.22.1");
  expect(base.image).toMatch(
    new RegExp(`^node:${pin.nodeVersion.replaceAll(".", "\\.")}-alpine3\\.24@sha256:[a-f0-9]{64}$`),
  );
  expect(dockerfile.split("\n").filter((line) => line.startsWith("FROM node:"))).toEqual([
    `FROM ${base.image} AS build`,
    `FROM ${base.image} AS runtime`,
  ]);
});
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
  const font = await readFile(
    new URL("../../apps/web/public/assets/midnight/HamBaziDisplay-Regular.ttf", import.meta.url),
  );
  await writeFile(join(directory, "assets/HamBaziDisplay-Regular.ttf"), font);
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
  const fontResponse = await fetch(origin + "/assets/HamBaziDisplay-Regular.ttf");
  expect(fontResponse.headers.get("content-type")).toBe("font/ttf");
  expect(fontResponse.headers.get("content-security-policy")).toBe(
    policy.headers["Content-Security-Policy"],
  );
  expect(Buffer.from(await fontResponse.arrayBuffer())).toEqual(font);
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
it("caches public versioned assets and revalidates mutable artwork without caching documents or errors", async () => {
  const { directory, environment } = await fixture();
  for (const name of ["index-abCD12_-.js", "hero-123456789abc.webp", "gem-sapphire.webp"])
    await writeFile(join(directory, "assets", name), "synthetic public bytes");
  servers.push(await startStaticWeb(environment, directory));
  const origin = `http://127.0.0.1:${environment.WEB_PORT}`;
  for (const name of ["index-abCD12_-.js", "hero-123456789abc.webp", "gem-sapphire.webp"]) {
    const url = `${origin}/assets/${name}`;
    const response = await fetch(url);
    expect(response.headers.get("cache-control")).toBe(
      name === "gem-sapphire.webp" ? "public, no-cache" : "public, max-age=31536000, immutable",
    );
    const etag = response.headers.get("etag");
    expect(etag).toMatch(/^W\/"[a-f0-9]{64}"$/);
    const cached = await fetch(url, { headers: { "If-None-Match": `"other", ${etag}` } });
    expect(cached.status).toBe(304);
    expect(cached.headers.get("etag")).toBe(etag);
    expect(cached.headers.get("content-security-policy")).toBe(
      response.headers.get("content-security-policy"),
    );
    expect(await cached.text()).toBe("");
    expect((await fetch(url, { headers: { "If-None-Match": 'W/"old-release"' } })).status).toBe(
      200,
    );
  }
  for (const path of ["/", "/index.html", "/missing.webp", "/security-headers.json"]) {
    const response = await fetch(origin + path, { headers: { "If-None-Match": "*" } });
    expect(response.status).not.toBe(304);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("etag")).toBeNull();
  }
  const health = await fetch(`http://127.0.0.1:${environment.WEB_HEALTH_PORT}/v1/health/ready`);
  expect(health.headers.get("cache-control")).toBe("no-store");
});
it("precompresses public text, negotiates br/gzip and preserves HEAD, validators and identity fallback", async () => {
  const { directory, environment } = await fixture();
  const body = "/* synthetic public application */\n".repeat(1000);
  await writeFile(join(directory, "assets/index-12345678.js"), body);
  servers.push(await startStaticWeb(environment, directory));
  const url = `http://127.0.0.1:${environment.WEB_PORT}/assets/index-12345678.js`;
  const identity = await fetch(url, { headers: { "Accept-Encoding": "identity" } });
  expect(identity.headers.get("content-encoding")).toBeNull();
  expect(Number(identity.headers.get("content-length"))).toBe(Buffer.byteLength(body));
  for (const [accept, encoding] of [
    ["br, gzip", "br"],
    ["gzip", "gzip"],
    ["br;q=0, gzip", "gzip"],
    ["br;q=0.5, gzip;q=1", "gzip"],
    ["BR", "br"],
    ["br;q=0, gzip;q=0", null],
    ["deflate", null],
  ]) {
    const headers = { "Accept-Encoding": accept };
    const response = await fetch(url, { headers });
    expect(response.headers.get("content-encoding")).toBe(encoding);
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(response.headers.get("etag")).toBe(identity.headers.get("etag"));
    expect(await response.text()).toBe(body);
    if (encoding)
      expect(Number(response.headers.get("content-length"))).toBeLessThan(body.length / 5);
    const head = await fetch(url, { method: "HEAD", headers });
    expect(head.headers.get("content-length")).toBe(response.headers.get("content-length"));
    expect(head.headers.get("content-encoding")).toBe(encoding);
    expect(await head.text()).toBe("");
    const cached = await fetch(url, {
      headers: { ...headers, "If-None-Match": identity.headers.get("etag") },
    });
    expect(cached.status).toBe(304);
    expect(cached.headers.get("vary")).toBe("Accept-Encoding");
  }
});
it("forwards only public compression and cache validators through each static ingress", async () => {
  for (const path of [
    "../docker/server/nginx.conf",
    "../docker/staging/owner.routes.conf",
    "../docker/staging/bot-onboarding.routes.conf",
  ]) {
    const config = await readFile(new URL(path, import.meta.url), "utf8");
    const location = config.match(
      /location \/ \{\s*limit_except GET \{[^}]*\}[^}]*proxy_pass http:\/\/10\.89\.18\.13:8080;[^}]*\}/,
    )?.[0];
    expect(location).toContain("proxy_pass_request_headers off;");
    expect(location).toContain("proxy_set_header Accept-Encoding $http_accept_encoding;");
    expect(location).toContain("proxy_set_header If-None-Match $http_if_none_match;");
    expect(location).not.toMatch(/proxy_set_header (Authorization|Cookie)/);
  }
});
it("keeps lobby delivery artwork within transfer budgets and binds filenames to the delivered bytes", async () => {
  const manifest = async (name) =>
    JSON.parse(await readFile(new URL(`../../docs/design/${name}`, import.meta.url), "utf8"));
  const home = (await manifest("lobby-delivery-assets.json")).assets;
  const kahroba = (await manifest("kahroba-palace-lobby-assets.json")).assets.map(
    (asset) => asset.delivery,
  );
  for (const [assets, budget] of [
    [home, 300_000],
    [kahroba, 800_000],
  ]) {
    let total = 0;
    for (const asset of assets) {
      const data = await readFile(new URL(`../../${asset.target}`, import.meta.url));
      const digest = createHash("sha256").update(data).digest("hex");
      expect(digest).toBe(asset.sha256);
      expect(asset.target).toContain(`-${digest.slice(0, 12)}.webp`);
      expect(data.length).toBe(asset.bytes);
      total += data.length;
    }
    expect(total).toBeLessThanOrEqual(budget);
  }
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
it("pins the private Web flag into image identity and limits it to the existing staging origins", () => {
  const policy = {
    webOrigin: "https://staging.hambazi.top",
    apiOrigin: "https://api-staging.hambazi.top",
  };
  const feature = kahrobaBuildFeatures("true", policy),
    source = "a".repeat(64);
  expect(buildIdentity(source, policy, feature)).not.toBe(buildIdentity(source, policy));
  expect(kahrobaBuildFeatures("false", policy)).toBeUndefined();
  for (const value of ["1", "yes"]) expect(() => kahrobaBuildFeatures(value, policy)).toThrow();
  expect(() =>
    kahrobaBuildFeatures("true", { ...policy, webOrigin: "https://public.example" }),
  ).toThrow();
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

it("serves supplied JPEG bytes with their correct MIME under the immutable inventory policy", async () => {
  const { directory, environment } = await fixture();
  const bytes = await readFile(
    new URL("../../apps/web/public/assets/coup/duke.jpeg", import.meta.url),
  );
  await writeFile(join(directory, "assets/duke.jpeg"), bytes);
  const server = await startStaticWeb(environment, directory);
  try {
    const response = await fetch(`http://127.0.0.1:${environment.WEB_PORT}/assets/duke.jpeg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  } finally {
    await server.close();
  }
});

it("accepts only explicit sealed local TLS input transports and binds them into image identity", () => {
  const ca = "a".repeat(64),
    input = "b".repeat(64);
  expect(localBuildTransport()).toBeUndefined();
  const transport = localBuildTransport("https://172.17.0.1:54439", ca, input);
  expect(transport).toEqual({
    origin: "https://172.17.0.1:54439",
    caSha256: ca,
    inputManifestSha256: input,
  });
  expect(localBuildTransport("https://127.0.0.1:54439", ca, input).origin).toBe(
    "https://127.0.0.1:54439",
  );
  const config = {
    inputTransport: transport,
    sourceDateEpoch: "1790000000",
    rewriteTimestamp: true,
  };
  expect(buildIdentity(ca, {}, undefined, config)).not.toBe(buildIdentity(ca, {}));
  expect(buildIdentity(ca, {}, undefined, config)).not.toBe(
    buildIdentity(ca, {}, undefined, { ...config, sourceDateEpoch: "1790000001" }),
  );
  expect(buildIdentity(ca, {}, undefined, config)).not.toBe(
    buildIdentity(ca, {}, undefined, {
      ...config,
      inputTransport: { ...transport, inputManifestSha256: ca },
    }),
  );
});
it("refuses partial, remote, unencrypted, credentialed and malformed build-input transports", () => {
  const ca = "a".repeat(64),
    input = "b".repeat(64);
  for (const origin of [
    "http://127.0.0.1:54439",
    "https://registry.npmjs.org:54439",
    "https://api-staging.hambazi.top:54439",
    "https://127.0.0.1",
    "https://127.0.0.1:443",
    "https://user:pass@127.0.0.1:54439",
    "https://127.0.0.1:54439/path",
    "https://127.0.0.1:54439?query=1",
    "https://127.0.0.1:54439#fragment",
  ])
    expect(() => localBuildTransport(origin, ca, input)).toThrow("PACKAGING_INPUT_INVALID");
  expect(() => localBuildTransport(undefined, ca, input)).toThrow("PACKAGING_INPUT_INVALID");
  expect(() => localBuildTransport("https://127.0.0.1:54439", undefined, input)).toThrow(
    "PACKAGING_INPUT_INVALID",
  );
  expect(() => localBuildTransport("https://127.0.0.1:54439", ca, "unbound")).toThrow(
    "PACKAGING_INPUT_INVALID",
  );
});

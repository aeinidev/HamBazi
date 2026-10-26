import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { request } from "node:https";
import { request as httpRequest } from "node:http";
import { describe, it, expect } from "vitest";
import { createAdminHttpApplication } from "../../src/composition/admin-http.js";
import { adminFixture, password, ownerPin } from "../admin/fixture.js";

if (process.env.TEST_ADMIN_INGRESS_CONFIRM !== "owned-local-only")
  throw new Error("Use test:admin:ingress only");
const run = promisify(execFile);
const docker = (args: string[]) =>
  run("docker", ["--host", "unix:///var/run/docker.sock", ...args], {
    env: { ...process.env, DOCKER_CONTEXT: "", DOCKER_TLS_VERIFY: "", DOCKER_CERT_PATH: "" },
  });
const image = (
  JSON.parse(
    await readFile(
      new URL("../../../../infra/docker/admin/test-image.json", import.meta.url),
      "utf8",
    ),
  ) as { image: string }
).image;
async function port() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const result = (server.address() as { port: number }).port;
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  return result;
}
async function fixture(wrongUpstreamName = false) {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-admin-ingress-"));
  const name = "hambazi-admin-ingress-test-" + randomUUID();
  const f = await adminFixture();
  await f.enroll();
  let app: Awaited<ReturnType<typeof createAdminHttpApplication>> | undefined,
    created = false;
  const observedIps: string[] = [];
  try {
    await run("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=admin.hambazi.top",
      "-addext",
      "subjectAltName=DNS:admin.hambazi.top,DNS:admin-api.internal,IP:127.0.0.1",
    ]);
    const cert = await readFile(join(directory, "cert.pem"));
    app = await createAdminHttpApplication(
      {
        service: f.service,
        csrf: f.crypto.csrf,
        cookieSeconds: 900,
        pendingSeconds: 120,
        reads: {
          page: async () => ({
            schemaVersion: 1,
            items: [],
            nextCursor: null,
            asOf: new Date().toISOString(),
          }),
          overview: async () => ({ schemaVersion: 1, metrics: [], asOf: new Date().toISOString() }),
          audit: async () => ({ schemaVersion: 1, items: [], asOf: new Date().toISOString() }),
        },
      },
      {
        key: await readFile(join(directory, "key.pem")),
        cert,
        origin: "https://admin.hambazi.top",
        peers: ["127.0.0.1"],
        ingressMode: "public-proxy",
        proxyPeers: ["127.0.0.1"],
        maxInFlight: 8,
        admitIp: async (ip) => {
          observedIps.push(ip);
          return true;
        },
        admitIdentity: async () => true,
      },
    );
    await app.listen(0, "127.0.0.1");
    const backend = (app.getHttpServer().address() as { port: number }).port;
    const httpsPort = await port(),
      httpPort = await port();
    const template = await readFile(
      new URL("../../../../infra/docker/admin/public-https.conf", import.meta.url),
      "utf8",
    );
    const candidate = template
      .replace("listen 80;", `listen 127.0.0.1:${httpPort};`)
      .replace("listen [::]:80;", "")
      .replace("listen 443 ssl;", `listen 127.0.0.1:${httpsPort} ssl;`)
      .replace("listen [::]:443 ssl;", "")
      .replaceAll("/etc/letsencrypt/live/hambazi-admin/fullchain.pem", "/test/cert.pem")
      .replaceAll("/etc/letsencrypt/live/hambazi-admin/privkey.pem", "/test/key.pem")
      .replaceAll("/opt/hambazi/admin/private/tls/service-ca.pem", "/test/cert.pem")
      .replaceAll("/var/www/hambazi-admin", "/test/web")
      .replaceAll("/var/lib/letsencrypt-admin", "/test/acme")
      .replaceAll("/var/log/nginx/hambazi-admin-error.log", "/tmp/admin-error.log")
      .replace("https://10.89.18.14:9444", `https://127.0.0.1:${backend}`)
      .replace(
        "proxy_ssl_name admin-api.internal;",
        `proxy_ssl_name ${wrongUpstreamName ? "wrong.internal" : "admin-api.internal"};`,
      );
    await mkdir(join(directory, "web/client/assets"), { recursive: true });
    await mkdir(join(directory, "acme/.well-known/acme-challenge"), { recursive: true });
    await writeFile(
      join(directory, "web/client/index.html"),
      '<html lang="fa" dir="rtl"><body>HamBazi</body></html>',
    );
    await writeFile(
      join(directory, "acme/.well-known/acme-challenge/probe"),
      "owned-local-acme-probe",
    );
    await writeFile(join(directory, "ingress.conf"), candidate);
    await writeFile(
      join(directory, "nginx.conf"),
      "pid /tmp/nginx.pid; error_log /tmp/nginx-error.log crit; events { worker_connections 128; } http { client_body_temp_path /tmp/body; proxy_temp_path /tmp/proxy; fastcgi_temp_path /tmp/fcgi; uwsgi_temp_path /tmp/uwsgi; scgi_temp_path /tmp/scgi; include /test/ingress.conf; }",
    );
    await docker(["image", "inspect", image]);
    await docker([
      "run",
      "--detach",
      "--rm",
      "--pull=never",
      "--name",
      name,
      "--network",
      "host",
      "--user",
      `${process.getuid!()}:${process.getgid!()}`,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--pids-limit",
      "64",
      "--memory",
      "128m",
      "--log-driver",
      "none",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=33554432,mode=1777",
      "--mount",
      `type=bind,src=${directory},dst=/test,readonly`,
      "--entrypoint",
      "nginx",
      image,
      "-c",
      "/test/nginx.conf",
      "-g",
      "daemon off;",
    ]);
    created = true;
    const send = (
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
      direct = false,
      plain = false,
    ) =>
      new Promise<{
        status: number;
        headers: Record<string, unknown>;
        text: string;
        json: Record<string, unknown>;
      }>((resolve, reject) => {
        const req = (plain ? httpRequest : request)(
          {
            hostname: "127.0.0.1",
            port: direct ? backend : plain ? httpPort : httpsPort,
            path,
            method: body === undefined ? "GET" : "POST",
            ...(!plain
              ? { ca: cert, servername: direct ? "admin-api.internal" : "admin.hambazi.top" }
              : {}),
            headers: {
              host: "admin.hambazi.top",
              ...(body === undefined
                ? {}
                : { origin: "https://admin.hambazi.top", "content-type": "application/json" }),
              ...headers,
            },
          },
          (res) => {
            let text = "";
            res.on("data", (c) => {
              text += String(c);
            });
            res.on("end", () => {
              let json = {};
              try {
                json = JSON.parse(text);
              } catch {
                /* HTML errors have no JSON payload. */
              }
              resolve({ status: res.statusCode!, headers: res.headers, text, json });
            });
          },
        );
        req.on("error", reject);
        req.setTimeout(3000, () => req.destroy(new Error("LOCAL_REQUEST_TIMEOUT")));
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
    for (let i = 0; i < 40; i++) {
      try {
        if ((await send("/")).status === 503) break;
      } catch {
        /* Wait only for this owned local listener. */
      }
      if (i === 39) throw new Error("LOCAL_INGRESS_NOT_READY");
      await new Promise((r) => setTimeout(r, 100));
    }
    return {
      f,
      send,
      observedIps,
      enable: () => writeFile(join(directory, "web/public-enabled"), ""),
      contain: () => writeFile(join(directory, "web/maintenance"), ""),
      close: async () => {
        if (created) await docker(["rm", "--force", name]);
        await app?.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (e) {
    if (created) await docker(["rm", "--force", name]).catch(() => {});
    await app?.close();
    await rm(directory, { recursive: true, force: true });
    throw e;
  }
}
const command = () => ({ schemaVersion: 1, commandId: randomUUID() });
const cookie = (reply: { headers: Record<string, unknown> }) =>
  (reply.headers["set-cookie"] as string[])[0]!.split(";")[0]!;
describe("owned local Nginx → private TLS Admin", () => {
  it("does not contact the application when the private upstream certificate hostname is wrong", async () => {
    const t = await fixture(true);
    try {
      await t.enable();
      expect((await t.send("/v1/admin/me/access")).status).toBe(502);
      expect(t.observedIps).toHaveLength(0);
    } finally {
      await t.close();
    }
  }, 30000);
  it("keeps admission closed, serves ACME and enforces authentication, forwarding trust and owner rotation", async () => {
    const t = await fixture();
    try {
      expect((await t.send("/")).status).toBe(503);
      expect(
        (await t.send("/.well-known/acme-challenge/probe", undefined, {}, false, true)).text,
      ).toBe("owned-local-acme-probe");
      expect((await t.send("/", undefined, {}, false, true)).status).toBe(308);
      await t.enable();
      const landing = await t.send("/");
      expect(landing.status).toBe(200);
      expect(landing.headers["cache-control"]).toBe("no-store");
      expect(landing.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect((await t.send("/v1/admin/me/access", undefined, {}, true)).status).toBe(403);
      expect(
        (
          await t.send(
            "/v1/admin/me/access",
            undefined,
            { "x-hambazi-client-ip": "127.0.0.1,8.8.8.8" },
            true,
          )
        ).status,
      ).toBe(403);
      const denied = await t.send("/v1/admin/auth/login", {
        ...command(),
        username: "owner_fixture",
        password: "IncorrectSyntheticPassword",
      });
      expect(denied.status).toBe(401);
      expect(denied.json).not.toHaveProperty("next");
      expect(denied.headers["set-cookie"]).toBeUndefined();
      const pending = await t.send(
        "/v1/admin/auth/login",
        { ...command(), username: "owner_fixture", password },
        { "x-hambazi-client-ip": "8.8.8.8", "x-forwarded-for": "8.8.8.8", "x-auth-role": "OWNER" },
      );
      expect(pending.json.next).toBe("PIN_REQUIRED");
      expect(t.observedIps).not.toContain("8.8.8.8");
      const pCookie = cookie(pending);
      expect((await t.send("/v1/admin/users", undefined, { cookie: pCookie })).status).toBe(401);
      const full = await t.send(
        "/v1/admin/auth/pin",
        { ...command(), pin: ownerPin },
        { cookie: pCookie, "x-csrf-token": String(pending.json.csrfToken) },
      );
      expect(full.json.next).toBe("SIGNED_IN");
      const fCookie = cookie(full);
      expect((await t.send("/v1/admin/overview", undefined, { cookie: fCookie })).status).toBe(200);
      expect(
        (
          await t.send("/v1/admin/users", undefined, {
            cookie: fCookie,
            authorization: "Bearer synthetic-player-token",
          })
        ).status,
      ).toBe(403);
      for (const path of ["auth/bootstrap", "auth/recovery", "auth/signup", "auth/unlock", "users"])
        expect((await t.send("/v1/admin/" + path, {}, { cookie: fCookie })).status).toBe(404);
      expect((await t.send("/.env")).status).toBe(404);
      expect((await t.send("/v1/health/ready")).status).toBe(404);
      const nextPassword = "SyntheticIngressReplacement456";
      const payload = { ...command(), password, currentPin: ownerPin, newPassword: nextPassword };
      expect(
        (await t.send("/v1/admin/auth/password/change", payload, { cookie: fCookie })).status,
      ).toBe(403);
      expect(
        (
          await t.send("/v1/admin/auth/password/change", payload, {
            cookie: fCookie,
            "x-csrf-token": String(full.json.csrfToken),
          })
        ).status,
      ).toBe(201);
      expect((await t.send("/v1/admin/me/access", undefined, { cookie: fCookie })).status).toBe(
        401,
      );
      expect(
        (
          await t.send("/v1/admin/auth/login", {
            ...command(),
            username: "owner_fixture",
            password,
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await t.send("/v1/admin/auth/login", {
            ...command(),
            username: "owner_fixture",
            password: nextPassword,
          })
        ).json.next,
      ).toBe("PIN_REQUIRED");
      await t.contain();
      expect((await t.send("/")).status).toBe(503);
      expect((await t.send("/v1/admin/me/access")).status).toBe(503);
    } finally {
      await t.close();
    }
  }, 30000);
  it("lets an ordinary admin sign in without PIN, denies missing grants and rate-limits before KDF", async () => {
    const t = await fixture();
    try {
      const root = t.f.state.operators.get(t.f.state.realm!.ownerId!)!;
      await t.f.repository.atomic((tx) =>
        tx.createOperator({
          ...root,
          id: randomUUID(),
          username: "support_fixture",
          pinVerifier: null,
        }),
      );
      await t.enable();
      const full = await t.send("/v1/admin/auth/login", {
        ...command(),
        username: "support_fixture",
        password,
      });
      expect(full.json.next).toBe("SIGNED_IN");
      expect((await t.send("/v1/admin/users", undefined, { cookie: cookie(full) })).status).toBe(
        403,
      );
      const requests = await Promise.all(
        Array.from({ length: 18 }, () =>
          t.send("/v1/admin/auth/login", { ...command(), username: "missing_fixture", password }),
        ),
      );
      expect(requests.some((r) => r.status === 429)).toBe(true);
      expect(
        requests.some(
          (r) =>
            r.status === 429 &&
            (r.json.error as { message?: string })?.message === "Too many requests",
        ),
      ).toBe(true);
      expect(requests.every((r) => r.status === 401 || r.status === 429)).toBe(true);
    } finally {
      await t.close();
    }
  }, 30000);
});

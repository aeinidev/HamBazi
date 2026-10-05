import { createServer, request } from "node:http";
import { afterEach, expect, it } from "vitest";
import { startLaptopProxy } from "../scripts/laptop-proxy.mjs";

const closers = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});
async function fixture() {
  const received = [];
  async function upstream(role) {
    const server = createServer((req, res) => {
      received.push({ role, url: req.url, headers: req.headers });
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Security-Policy": "default-src 'none'",
      });
      res.end(role);
    });
    await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
    closers.push(() => new Promise((accept) => server.close(accept)));
    return server.address().port;
  }
  const apiPort = await upstream("api"),
    webPort = await upstream("web");
  const reserve = createServer();
  await new Promise((accept) => reserve.listen(0, "127.0.0.1", accept));
  const port = reserve.address().port;
  await new Promise((accept) => reserve.close(accept));
  const proxy = await startLaptopProxy({
    port,
    apiPort,
    webPort,
    origin: () => "https://laptop.example",
  });
  closers.push(() => proxy.close());
  function get(path, headers = {}) {
    return new Promise((accept, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path, headers }, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => accept({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on("error", reject);
      req.end();
    });
  }
  return { proxy, get, received };
}
it("keeps ingress unavailable until ready, then serves real API and immutable Web headers", async () => {
  const f = await fixture();
  expect((await f.get("/")).status).toBe(503);
  expect(f.received).toHaveLength(0);
  f.proxy.ready();
  expect((await f.get("/v1/auth/session")).body).toBe("api");
  const web = await f.get("/");
  expect(web.body).toBe("web");
  expect(web.headers["content-security-policy"]).toBe("default-src 'none'");
});
it("does not expose health, internal Bot, admin, files, traversal or unknown Host", async () => {
  const f = await fixture();
  f.proxy.ready();
  for (const path of [
    "/v1/health/ready",
    "/v1/metrics",
    "/v1/internal/bot/updates",
    "/v1/admin",
    "/.env",
    "/%2eenv",
    "/v1/auth/%2e%2e/internal",
    "/socket.io/?transport=polling",
  ])
    expect((await f.get(path)).status).toBe(404);
  expect((await f.get("/", { host: "attacker.example" })).status).toBe(404);
  expect(f.received).toHaveLength(0);
});
it("discards injected forwarded and Cloudflare identity, while preserving application authorization", async () => {
  const f = await fixture();
  f.proxy.ready();
  await f.get("/v1/auth/session", {
    "x-forwarded-for": "203.0.113.99",
    "x-forwarded-proto": "https",
    "cf-connecting-ip": "203.0.113.42",
  });
  expect(f.received[0].headers["x-forwarded-for"]).toBeUndefined();
  expect(f.received[0].headers["x-forwarded-proto"]).toBe("http");
  await f.get("/v1/auth/session", {
    host: "laptop.example",
    "cf-connecting-ip": "203.0.113.42",
    "x-forwarded-for": "203.0.113.99",
    authorization: "Bearer synthetic",
  });
  expect(f.received[1].headers["x-forwarded-for"]).toBeUndefined();
  expect(f.received[1].headers["x-forwarded-proto"]).toBe("https");
  expect(f.received[1].headers["cf-connecting-ip"]).toBeUndefined();
  expect(f.received[1].headers.authorization).toBe("Bearer synthetic");
});

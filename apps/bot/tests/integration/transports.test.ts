import { createServer, Agent } from "node:https";
import { request as plainRequest } from "node:http";
import { createServer as netServer } from "node:net";
import { Api } from "grammy";
import { createTelegramSender } from "../../src/telegram.js";
import { createRelayTransport } from "../../src/relay-transport.js";
import { createTelegramApi } from "../../src/telegram-api.js";
import { startBot } from "../../src/composition/runtime.js";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { createBotHttp, webhookPath } from "../../src/composition/http.js";
import { createBotLogger } from "../../src/composition/logger.js";
import { createCorrelation, withCorrelation, healthPaths } from "@hambazi/observability";
import { createBackend, RetryDelivery } from "../../src/backend.js";
import { createDeliveryHandler } from "../../src/delivery.js";
import { fixture, raw, delivery } from "../unit/fixtures.js";
import { certificate, post, withCertificate } from "../tls-fixture.js";
let tls: Awaited<ReturnType<typeof certificate>>;
beforeAll(async () => {
  tls = await certificate();
});
const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closes.splice(0).map((close) => close()));
});
async function setup(maxInFlight = 8) {
  const f = fixture();
  const output: string[] = [];
  const handler = vi.fn(createDeliveryHandler(f));
  const http = createBotHttp({
    tls,
    secret: { reveal: () => "w".repeat(40) },
    backend: f.backend,
    handle: handler,
    timeoutMs: 200,
    maxInFlight,
    logger: createBotLogger({
      write: (v: string) => {
        output.push(v);
      },
    }),
  });
  await http.server.listen({ host: "127.0.0.1", port: 0 });
  closes.push(http.close);
  const port = (http.server.server.address() as AddressInfo).port;
  return {
    ...f,
    ...http,
    output,
    handler,
    port,
    send: (body: unknown = raw(), headers: Record<string, string | string[]> = {}) =>
      post(port, tls.cert, webhookPath, body, {
        "x-telegram-bot-api-secret-token": "w".repeat(40),
        ...headers,
      }),
  };
}
describe("real TLS webhook boundary", () => {
  it("does not accept plaintext webhook delivery", async () => {
    const f = await setup();
    const status = await new Promise<number>((resolve) => {
      const req = plainRequest(
        { host: "127.0.0.1", port: f.port, path: webhookPath, method: "POST", agent: false },
        (res) => {
          res.resume();
          res.once("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", () => resolve(0));
      req.setTimeout(1000, () => req.destroy());
      req.end();
    });
    expect(status).not.toBe(200);
    expect(f.backend.admit).not.toHaveBeenCalled();
  });
  it("authenticates, admits, sends and acknowledges before 200", async () => {
    const f = await setup();
    const res = await f.send();
    expect(res.status).toBe(200);
    expect(f.backend.admit).toHaveBeenCalledOnce();
    expect(f.backend.acknowledge).toHaveBeenCalledOnce();
    expect(res.headers["cache-control"]).toBe("no-store");
  });
  it.each(["", "forged", "w".repeat(39)])(
    "rejects bad secret %# before admission/body parse",
    async (secret) => {
      const f = await setup();
      expect((await f.send("{", { "x-telegram-bot-api-secret-token": secret })).status).toBe(401);
      expect(f.backend.admit).not.toHaveBeenCalled();
    },
  );
  it("rejects duplicate secret headers", async () => {
    const f = await setup();
    expect(
      (await f.send(raw(), { "x-telegram-bot-api-secret-token": ["w".repeat(40), "w".repeat(40)] }))
        .status,
    ).toBe(401);
  });
  it.each(["origin", "forwarded", "x-forwarded-for", "x-forwarded-proto"])(
    "rejects %s",
    async (header) => {
      const f = await setup();
      expect((await f.send(raw(), { [header]: "https" })).status).toBe(403);
    },
  );
  it("rate-admits ignored updates but never creates backend effects", async () => {
    const f = await setup();
    expect((await f.send({ update_id: 1, edited_message: {} })).status).toBe(200);
    expect(f.backend.admit).toHaveBeenCalledOnce();
    expect(f.backend.process).not.toHaveBeenCalled();
  });
  it("never succeeds on distributed denial, including malformed input", async () => {
    const f = await setup();
    f.backend.admit.mockRejectedValue(new RetryDelivery(7));
    const r = await f.send("{");
    expect(r.status).toBe(503);
    expect(r.headers["retry-after"]).toBe("7");
    expect(f.handler).not.toHaveBeenCalled();
  });
  it.each([
    ["{", 400],
    [{ message: {} }, 400],
    ["x".repeat(65537), 413],
  ])("rejects invalid/oversized body %#", async (body, status) => {
    const f = await setup();
    expect((await f.send(body)).status).toBe(status);
    expect(f.backend.process).not.toHaveBeenCalled();
  });
  it.each(["process", "send", "ack"] as const)("does not acknowledge %s failure", async (stage) => {
    const f = await setup();
    if (stage === "process")
      f.backend.process.mockRejectedValue(new Error("private backend details"));
    if (stage === "send") f.sender.send.mockRejectedValue(new Error("private token name"));
    if (stage === "ack")
      f.backend.acknowledge.mockRejectedValue(new Error("private acknowledgement"));
    const r = await f.send();
    expect(r.status).toBe(503);
    expect(r.body).not.toContain("private");
    expect(f.output.join("")).not.toMatch(/private|authorization|telegram|message_id|wwwwww/);
  });
  it("fails closed when admission times out", async () => {
    const f = await setup();
    f.backend.admit.mockImplementation(
      (signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new RetryDelivery()), { once: true }),
        ),
    );
    expect((await f.send()).status).toBe(503);
    expect(f.handler).not.toHaveBeenCalled();
  });
  it("bounds in-flight requests and drains before closing", async () => {
    const f = await setup(1);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    f.backend.admit.mockImplementation(async () => {
      entered();
      await gate;
    });
    const first = f.send();
    await started;
    expect((await f.send()).status).toBe(503);
    let closed = false;
    const closing = f.close().then(() => {
      closed = true;
    });
    expect(closed).toBe(false);
    release();
    expect((await first).status).toBe(200);
    await closing;
  });
  it("rejects query paths and untrusted TLS", async () => {
    const f = await setup();
    expect((await post(f.port, tls.cert, webhookPath + "?token=x", raw())).status).toBe(404);
    await expect(post(f.port, "", webhookPath, raw())).rejects.toThrow();
  });
});
describe("private backend HTTPS client", () => {
  async function backendServer(handler: Parameters<typeof createServer>[1]) {
    const server = createServer({ key: tls.key.reveal(), cert: tls.cert }, handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closes.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    );
    const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return origin;
  }
  async function client(handler: Parameters<typeof createServer>[1], trusted = true) {
    const origin = await backendServer(handler);
    const c = createBackend({
      origin,
      bearer: { reveal: () => "Bearer synthetic" },
      timeoutMs: 100,
      ...(trusted ? { ca: tls.cert } : {}),
    });
    closes.push(async () => c.close());
    return c.backend;
  }
  it("sends a scoped bearer to the fixed path and validates its response", async () => {
    let auth: unknown;
    let path: unknown;
    let traceparent: unknown;
    const c = await client((req, res) => {
      auth = req.headers.authorization;
      path = req.url;
      traceparent = req.headers.traceparent;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ schemaVersion: 1, ok: true }));
    });
    const context = createCorrelation();
    await withCorrelation(context, () => c.admit(AbortSignal.timeout(1000)));
    expect(auth).toBe("Bearer synthetic");
    expect(path).toBe("/v1/internal/bot/admit");
    expect(traceparent).toBe(context.traceparent);
  });
  it.each([301, 302, 400, 401, 403, 429, 500, 503])(
    "rejects HTTP %s without following redirects",
    async (status) => {
      const c = await client((_req, res) => {
        res.writeHead(status, { "retry-after": "9", location: "https://public.example/" });
        res.end();
      });
      await expect(c.admit(AbortSignal.timeout(1000))).rejects.toMatchObject({
        retryAfterSeconds: 9,
      });
    },
  );
  it.each(["{", JSON.stringify({ schemaVersion: 1, ok: true, token: "secret" }), "x".repeat(8193)])(
    "rejects malformed/extra/oversized response %#",
    async (body) => {
      const c = await client((_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(body);
      });
      await expect(c.admit(AbortSignal.timeout(1000))).rejects.toThrow(
        /^Bot delivery is incomplete$/,
      );
    },
  );
  it("checks certificates", async () => {
    const c = await client((_req, res) => res.end(), false);
    await expect(c.admit(AbortSignal.timeout(1000))).rejects.toThrow(
      /^Bot delivery is incomplete$/,
    );
  });
  it("bounds a stalled response", async () => {
    const c = await client(() => {});
    await expect(c.admit(AbortSignal.timeout(1000))).rejects.toThrow(
      /^Bot delivery is incomplete$/,
    );
  });
  it("sanitizes invalid outgoing DTOs before any network effect", async () => {
    let calls = 0;
    const c = await client((_req, res) => {
      calls++;
      res.end();
    });
    await expect(
      c.process(
        { private: "submitted name" } as unknown as Parameters<typeof c.process>[0],
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow(/^Bot delivery is incomplete$/);
    await expect(
      c.acknowledge(
        { private: "submitted name" } as unknown as Parameters<typeof c.acknowledge>[0],
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow(/^Bot delivery is incomplete$/);
    expect(calls).toBe(0);
  });
  it("uses grammY over real HTTPS and preserves Telegram flood retry hints", async () => {
    let payload: unknown;
    let status = 200;
    const origin = await backendServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        payload = JSON.parse(body);
        res.setHeader("content-type", "application/json");
        res.statusCode = status;
        res.end(
          JSON.stringify(
            status === 200
              ? {
                  ok: true,
                  result: {
                    message_id: 900,
                    chat: { id: 100, type: "private" },
                    date: 1,
                    text: "Synthetic",
                  },
                }
              : {
                  ok: false,
                  error_code: 429,
                  description: "Synthetic flood limit",
                  parameters: { retry_after: 7 },
                },
          ),
        );
      });
    });
    const agent = new Agent({ ca: tls.cert });
    closes.push(async () => agent.destroy());
    const api = new Api(`123:${"a".repeat(32)}`, {
      apiRoot: origin,
      baseFetchConfig: { agent },
      timeoutSeconds: 1,
    });
    const sender = createTelegramSender(
      { token: { reveal: () => "unused" }, miniAppUrl: "https://mini.example", timeoutMs: 1000 },
      api,
    );
    expect(await sender.send(delivery, AbortSignal.timeout(2000))).toBe(900);
    expect(payload).toMatchObject({ chat_id: "100", reply_markup: { force_reply: true } });
    status = 429;
    await expect(sender.send(delivery, AbortSignal.timeout(2000))).rejects.toMatchObject({
      retryAfterSeconds: 7,
    });
  });
  it("runs the relay SDK over verified TLS without putting the bot token on that hop", async () => {
    let path: string | undefined;
    let key: unknown;
    let payload: unknown;
    const origin = await backendServer((req, res) => {
      path = req.url;
      key = req.headers["x-hambazi-proxy-key"];
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        payload = JSON.parse(body);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            result: { message_id: 900, chat: { id: 100, type: "private" } },
          }),
        );
      });
    });
    const options = {
      token: { reveal: () => `123:${"a".repeat(32)}` },
      timeoutMs: 1000,
      telegramProxy: { origin, key: { reveal: () => "p".repeat(43) } },
    };
    const api = createTelegramApi(options, createRelayTransport({ ca: tls.cert }));
    expect(
      await createTelegramSender({ ...options, miniAppUrl: "https://mini.example" }, api).send(
        delivery,
        AbortSignal.timeout(2000),
      ),
    ).toBe(900);
    expect(path).toBe("/v1/sendMessage");
    expect(key).toBe("p".repeat(43));
    expect(payload).toMatchObject({ chat_id: "100" });
    expect(JSON.stringify([path, payload])).not.toContain(options.token.reveal());
    // The same self-signed endpoint must fail with ordinary system trust.
    await expect(createTelegramApi(options).getMe()).rejects.toThrow();
  });
  it("aborts a stalled real HTTPS relay and never follows its redirects", async () => {
    let requests = 0;
    let redirect = true;
    const origin = await backendServer((_req, res) => {
      requests++;
      if (redirect) {
        res.writeHead(302, {
          location: "https://other.example",
          "content-type": "application/json",
        });
        res.end("{}");
      }
    });
    const options = {
      token: { reveal: () => `123:${"a".repeat(32)}` },
      timeoutMs: 100,
      telegramProxy: { origin, key: { reveal: () => "p".repeat(43) } },
    };
    await expect(
      createTelegramApi(options, createRelayTransport({ ca: tls.cert })).getMe(),
    ).rejects.toThrow();
    expect(requests).toBe(1);
    redirect = false;
    await expect(
      createTelegramApi(options, createRelayTransport({ ca: tls.cert })).getMe(),
    ).rejects.toThrow();
    expect(requests).toBe(2);
  });
  it("sends initial and repeated starts as text only with the correct bottom keyboard", async () => {
    const received: { method: string; contentType: string; payload: Record<string, unknown> }[] =
      [];
    const origin = await backendServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        received.push({
          method: req.url!.split("/").at(-1)!,
          contentType: String(req.headers["content-type"]),
          payload: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            ok: true,
            result: { message_id: 901, chat: { id: 100, type: "private" }, date: 1 },
          }),
        );
      });
    });
    const agent = new Agent({ ca: tls.cert });
    closes.push(async () => agent.destroy());
    const api = new Api(`123:${"a".repeat(32)}`, {
      apiRoot: origin,
      baseFetchConfig: { agent },
      timeoutSeconds: 2,
    });
    const sender = createTelegramSender(
      { token: { reveal: () => "unused" }, miniAppUrl: "https://mini.example", timeoutMs: 2000 },
      api,
    );
    for (const reply of ["CREATE_ACCOUNT", "WELCOME_REGISTERED", "WELCOME_REGISTERED"] as const)
      expect(await sender.send({ ...delivery, reply }, AbortSignal.timeout(3000))).toBe(901);
    for (const r of received) {
      expect(r.method).toBe("sendMessage");
      expect(r.contentType).toContain("application/json");
      expect(r.payload.text).toBe("برای ادامه، از دکمه‌های پایین استفاده کن.");
      expect(r.payload).not.toHaveProperty("photo");
      expect(r.payload).not.toHaveProperty("caption");
    }
    expect(received[0]!.payload.reply_markup).toMatchObject({
      keyboard: [[{ text: "ایجاد حساب کاربری", style: "primary" }]],
    });
    for (const r of received.slice(1))
      expect(r.payload.reply_markup).toMatchObject({
        keyboard: [[{ text: "پروفایل من" }], [{ text: "ارتباط با پشتیبان" }]],
      });
  });
  it("starts configured TLS runtime, probes only admission, and closes cleanly", async () => {
    await withCertificate(async (cert, files) => {
      const requests: string[] = [];
      let dependencyReady = true;
      const backend = createServer({ key: cert.key.reveal(), cert: cert.cert }, (req, res) => {
        requests.push(req.url!);
        res.setHeader("content-type", "application/json");
        if (req.url === healthPaths.ready) {
          res.statusCode = dependencyReady ? 200 : 503;
          res.end(
            JSON.stringify({ schemaVersion: 1, status: dependencyReady ? "READY" : "NOT_READY" }),
          );
        } else res.end(JSON.stringify({ schemaVersion: 1, ok: true }));
      });
      await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
      const reservation = netServer();
      await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
      const port = (reservation.address() as AddressInfo).port;
      await new Promise<void>((resolve) => reservation.close(() => resolve()));
      const env = {
        NODE_ENV: "test",
        TELEGRAM_BOT_TOKEN: `123:${"a".repeat(32)}`,
        TELEGRAM_BOT_USERNAME: "hambazi_test_bot",
        TELEGRAM_WEBHOOK_SECRET: "w".repeat(40),
        BOT_SERVICE_KEY_ID: "current",
        BOT_SERVICE_KEY: Buffer.alloc(32, 17).toString("base64url"),
        BOT_API_ORIGIN: `https://127.0.0.1:${(backend.address() as AddressInfo).port}`,
        BOT_BIND_ADDRESS: "127.0.0.1",
        BOT_PORT: String(port),
        BOT_TLS_KEY_FILE: files.keyFile,
        BOT_TLS_CERT_FILE: files.certFile,
        BOT_MINI_APP_URL: "https://mini.example",
        BOT_BACKEND_TIMEOUT_MS: "1000",
        BOT_SEND_TIMEOUT_MS: "1000",
        BOT_ONBOARDING_LEASE_MS: "15000",
        BOT_MAX_IN_FLIGHT: "8",
        BOT_API_CA_FILE: files.certFile,
      };
      try {
        await expect(
          startBot({ ...env, BOT_API_CA_FILE: undefined }, createBotLogger({ write: () => {} })),
        ).rejects.toThrow(/^Bot startup failed$/);
        const running = await startBot(env, createBotLogger({ write: () => {} }));
        try {
          expect(
            (
              await post(
                port,
                cert.cert,
                webhookPath,
                { update_id: 1, edited_message: {} },
                { "x-telegram-bot-api-secret-token": "w".repeat(40) },
              )
            ).status,
          ).toBe(200);
          expect(requests.every((p) => p === "/v1/internal/bot/admit")).toBe(true);
          expect((await running.health.ready()).status).toBe("READY");
          dependencyReady = false;
          expect((await running.health.ready()).status).toBe("NOT_READY");
          expect(running.health.live().status).toBe("LIVE");
          dependencyReady = true;
          expect((await running.health.ready()).status).toBe("READY");
        } finally {
          await running.close();
          await running.close();
          expect((await running.health.ready()).status).toBe("NOT_READY");
        }
      } finally {
        await new Promise<void>((resolve) => {
          backend.close(() => resolve());
          backend.closeAllConnections();
        });
      }
    });
  });
});

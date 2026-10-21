import { describe, expect, it, vi } from "vitest";
import { createGateway, type GatewayEnv } from "../../src/cloudflare/worker.js";
import { createTelegramApi } from "../../src/telegram-api.js";
import { createTelegramSender } from "../../src/telegram.js";
import { delivery } from "./fixtures.js";

const env: GatewayEnv = {
  BOT_TOKEN: `123:${"a".repeat(32)}`,
  PROXY_SHARED_SECRET: "p".repeat(43),
  VPS_WEBHOOK_URL: "https://bot.example/v1/telegram/webhook",
  VPS_WEBHOOK_SECRET: "v".repeat(43),
  TELEGRAM_WEBHOOK_SECRET: "w".repeat(43),
  GATEWAY_ENABLED: "true",
};
const relay = "https://gateway.example";
const request = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(relay + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const telegramReply = () =>
  Response.json({
    ok: true,
    result: { message_id: 900, chat: { id: 100, type: "private" } },
  });

describe("Cloudflare gateway boundary", () => {
  it("preserves the standalone bot until forwarding is explicitly enabled", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(telegramReply());
    const staged = { ...env };
    delete staged.GATEWAY_ENABLED;
    const res = await createGateway(upstream).fetch(
      request(
        "/webhook",
        {
          update_id: 1,
          message: { from: { id: 100 }, chat: { id: 100, type: "private" }, text: "/ping" },
        },
        { "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET! },
      ),
      staged,
    );
    expect(res.status).toBe(200);
    expect(upstream.mock.calls[0]![0]).toBe(
      "https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage",
    );
    expect(upstream.mock.calls[0]![1]!.headers).not.toHaveProperty(
      "x-telegram-bot-api-secret-token",
    );
    expect(JSON.parse(String(upstream.mock.calls[0]![1]!.body)).text).toContain(
      "Cloudflare Workers",
    );
  });
  it("forwards only verified updates and only acknowledges completed origin work", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    const gateway = createGateway(upstream);
    const update = { update_id: 9, message: { text: "private text" } };
    const res = await gateway.fetch(
      request("/webhook", update, {
        "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET!,
        authorization: "must-not-be-forwarded",
        "x-forwarded-for": "public",
        cookie: "private",
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
    const [url, options] = upstream.mock.calls[0]!;
    expect(url).toBe(env.VPS_WEBHOOK_URL);
    expect(options!.body).toBe(JSON.stringify(update));
    expect(options!.redirect).toBe("error");
    expect(options!.headers).toEqual({
      "content-type": "application/json",
      accept: "application/json",
      "x-telegram-bot-api-secret-token": env.VPS_WEBHOOK_SECRET,
    });
  });
  it("preserves the existing token-derived webhook secret without resetting Telegram", async () => {
    const bytes = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("telegram-webhook-v1:" + env.BOT_TOKEN),
      ),
    );
    const secret = Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
    const legacy = { ...env };
    delete legacy.TELEGRAM_WEBHOOK_SECRET;
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
    expect(
      (
        await createGateway(upstream).fetch(
          request(
            "/webhook",
            { update_id: 1 },
            {
              "x-telegram-bot-api-secret-token": secret,
            },
          ),
          legacy,
        )
      ).status,
    ).toBe(200);
  });
  it.each(["/webhook", "/v1/sendMessage"])(
    "rejects forged %s before network work",
    async (path) => {
      const upstream = vi.fn<typeof fetch>();
      expect(
        (await createGateway(upstream).fetch(request(path, { update_id: 1 }), env)).status,
      ).toBe(401);
      expect(upstream).not.toHaveBeenCalled();
    },
  );
  it.each(["/v1/getUpdates", "/v1/setWebhook", "/file/bot123/photo", "/v1/getMe?token=x"])(
    "does not expose %s",
    async (path) => {
      const upstream = vi.fn<typeof fetch>();
      expect((await createGateway(upstream).fetch(request(path, {}), env)).status).toBe(404);
      expect(upstream).not.toHaveBeenCalled();
    },
  );
  it("fails closed for incomplete or recursive origin configuration", async () => {
    const upstream = vi.fn<typeof fetch>();
    for (const override of [
      { PROXY_SHARED_SECRET: "" },
      { VPS_WEBHOOK_URL: relay + "/v1/telegram/webhook" },
      { VPS_WEBHOOK_URL: "http://bot.example/v1/telegram/webhook" },
    ])
      expect(
        (
          await createGateway(upstream).fetch(request("/webhook", { update_id: 1 }), {
            ...env,
            ...override,
          })
        ).status,
      ).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("bounds authenticated input before origin effects", async () => {
    const upstream = vi.fn<typeof fetch>();
    const gateway = createGateway(upstream);
    for (const body of [
      { update_id: -1 },
      { message: {} },
      { update_id: 1, text: "x".repeat(65536) },
    ]) {
      expect(
        (
          await gateway.fetch(
            request("/webhook", body, {
              "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET!,
            }),
            env,
          )
        ).status,
      ).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([503, 429, 401])("does not acknowledge origin HTTP %s", async (status) => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: false }, { status }));
    expect(
      (
        await createGateway(upstream).fetch(
          request(
            "/webhook",
            { update_id: 1 },
            {
              "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET!,
            },
          ),
          env,
        )
      ).status,
    ).toBe(503);
    expect(upstream).toHaveBeenCalledOnce();
  });
});

describe("grammY through the authenticated Cloudflare relay", () => {
  const apiOptions = {
    token: { reveal: () => env.BOT_TOKEN },
    timeoutMs: 100,
    telegramProxy: { origin: relay, key: { reveal: () => env.PROXY_SHARED_SECRET } },
  };
  it("runs actual SDK send through Worker and strips credentials on the Telegram hop", async () => {
    const telegram = vi.fn<typeof fetch>().mockResolvedValue(telegramReply());
    const gateway = createGateway(telegram);
    const transport = vi.fn<typeof fetch>((url, options) =>
      gateway.fetch(new Request(url, options), env),
    );
    const api = createTelegramApi(apiOptions, transport);
    const sender = createTelegramSender({ ...apiOptions, miniAppUrl: "https://mini.example" }, api);
    expect(await sender.send(delivery, AbortSignal.timeout(1000))).toBe(900);
    const [url, options] = transport.mock.calls[0]!;
    expect(String(url)).toBe(relay + "/v1/sendMessage");
    expect(JSON.stringify([String(url), options])).not.toContain(env.BOT_TOKEN);
    expect(options!.headers).toMatchObject({ "x-hambazi-proxy-key": env.PROXY_SHARED_SECRET });
    expect(telegram.mock.calls[0]![0]).toBe(
      "https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage",
    );
    expect(telegram.mock.calls[0]![1]!.headers).not.toHaveProperty("x-hambazi-proxy-key");
  });
  it("preserves flood retry hints without resending or direct fallback", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          ok: false,
          error_code: 429,
          description: "Synthetic",
          parameters: { retry_after: 7 },
        },
        { status: 429 },
      ),
    );
    const api = createTelegramApi(apiOptions, transport);
    await expect(
      createTelegramSender({ ...apiOptions, miniAppUrl: "https://mini.example" }, api).send(
        delivery,
        AbortSignal.timeout(1000),
      ),
    ).rejects.toMatchObject({ retryAfterSeconds: 7 });
    expect(transport).toHaveBeenCalledOnce();
  });
  it.each(["redirect", "html", "oversized", "network"])(
    "rejects %s without leaking or retrying",
    async (kind) => {
      const transport = vi.fn<typeof fetch>();
      if (kind === "network")
        transport.mockRejectedValue(new Error(env.BOT_TOKEN + env.PROXY_SHARED_SECRET));
      else
        transport.mockResolvedValue(
          kind === "redirect"
            ? new Response(null, { status: 302, headers: { location: "https://other.example" } })
            : kind === "html"
              ? new Response("blocked", { headers: { "content-type": "text/html" } })
              : Response.json({ text: "x".repeat(65536) }),
        );
      const api = createTelegramApi(apiOptions, transport);
      await expect(
        createTelegramSender({ ...apiOptions, miniAppUrl: "https://mini.example" }, api).send(
          delivery,
          AbortSignal.timeout(1000),
        ),
      ).rejects.toThrow(/^Bot delivery is incomplete$/);
      expect(transport).toHaveBeenCalledOnce();
    },
  );
  it("propagates SDK cancellation to the native fetch boundary", async () => {
    const transport = vi.fn<typeof fetch>(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener("abort", () => reject(new Error("ABORTED")), {
            once: true,
          });
        }),
    );
    const api = createTelegramApi({ ...apiOptions, timeoutMs: 50 }, transport);
    await expect(api.getMe()).rejects.toThrow();
    expect(transport.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
  });
});

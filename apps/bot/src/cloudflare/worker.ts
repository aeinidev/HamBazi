/** Standalone Web-API entry point. No account, game or persistence rules live here. */
export interface GatewayEnv {
  BOT_TOKEN: string;
  PROXY_SHARED_SECRET: string;
  VPS_WEBHOOK_URL: string;
  VPS_WEBHOOK_SECRET: string;
  // Optional overlap input; absent preserves the existing Worker's derived secret.
  TELEGRAM_WEBHOOK_SECRET?: string;
  GATEWAY_ENABLED?: string;
}

const methods = new Set([
  "getMe",
  "getWebhookInfo",
  "sendMessage",
  "getChatMenuButton",
  "setChatMenuButton",
  "getMyDescription",
  "setMyDescription",
]);
const tokenPattern = /^[1-9][0-9]{0,15}:[A-Za-z0-9_-]{30,100}$/;
const secretPattern = /^[A-Za-z0-9_-]{32,256}$/;
const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "strict-transport-security": "max-age=31536000",
    },
  });

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function equalSecret(value: string | null, expected: string) {
  if (!value || value.length > 256) return false;
  const [a, b] = await Promise.all([digest(value), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

function configured(env: GatewayEnv, ownOrigin: string) {
  try {
    const relayReady =
      tokenPattern.test(env.BOT_TOKEN) &&
      /^[A-Za-z0-9_-]{43,128}$/.test(env.PROXY_SHARED_SECRET) &&
      env.PROXY_SHARED_SECRET !== env.VPS_WEBHOOK_SECRET &&
      env.PROXY_SHARED_SECRET !== env.TELEGRAM_WEBHOOK_SECRET &&
      (!env.TELEGRAM_WEBHOOK_SECRET || secretPattern.test(env.TELEGRAM_WEBHOOK_SECRET));
    if (!relayReady || ![undefined, "false", "true"].includes(env.GATEWAY_ENABLED)) return false;
    if (env.GATEWAY_ENABLED !== "true") return true;
    const origin = new URL(env.VPS_WEBHOOK_URL);
    return (
      secretPattern.test(env.VPS_WEBHOOK_SECRET) &&
      origin.protocol === "https:" &&
      origin.origin !== ownOrigin &&
      !origin.username &&
      !origin.password &&
      !origin.search &&
      !origin.hash &&
      origin.pathname === "/v1/telegram/webhook"
    );
  } catch {
    return false;
  }
}

// Retain the owner's standalone menu until the VPS sender is qualified.
function standaloneReply(input: unknown): Record<string, unknown> | undefined {
  const update = input as {
    message?: {
      from?: { id?: number; is_bot?: boolean };
      chat?: { id?: number; type?: string };
      text?: string;
    };
  };
  const m = update.message;
  if (
    !m ||
    m.from?.is_bot ||
    typeof m.text !== "string" ||
    m.chat?.type !== "private" ||
    !Number.isSafeInteger(m.chat.id) ||
    !Number.isSafeInteger(m.from?.id)
  )
    return;
  const text = m.text.trim();
  const command = text.split(/\s/)[0]!.split("@")[0]!.toLowerCase();
  const help =
    "از دکمه‌های پایین استفاده کن یا دستور بفرست:\n/start — منوی اصلی\n/help — راهنما\n/ping — بررسی اتصال\n/id — شناسه کاربر و گفتگو";
  const replyText =
    command === "/start"
      ? "سلام! 👋\nرباتت روی Cloudflare فعال است.\nبرای شروع یکی از دکمه‌های پایین را بزن."
      : command === "/ping" || text === "📡 وضعیت اتصال"
        ? "✅ اتصال برقرار است. ربات روی Cloudflare Workers پاسخ می‌دهد."
        : command === "/id" || text === "🆔 شناسه من"
          ? "🆔 شناسه شما: " + m.from!.id + "\nشناسه گفتگو: " + m.chat.id
          : command === "/help" || text === "📖 راهنما"
            ? help
            : "پیامت دریافت شد. این نسخه فعلاً دستورهای پایه را دارد.\n\n" + help;
  return {
    chat_id: m.chat.id,
    text: replyText,
    reply_markup: {
      keyboard: [[{ text: "📡 وضعیت اتصال" }, { text: "🆔 شناسه من" }], [{ text: "📖 راهنما" }]],
      resize_keyboard: true,
    },
  };
}

async function boundedBody(response: Request | Response, limit: number, signal?: AbortSignal) {
  if (response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json")
    throw new Error("INVALID_JSON");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("INVALID_JSON");
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    signal?.throwIfAborted();
    while (true) {
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }
      chunks.push(part.value);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(body);
  JSON.parse(text);
  return text;
}

/** Injected only by tests; production uses the Worker's native fetch. */
export function createGateway(transport = globalThis.fetch) {
  return {
    async fetch(request: Request, env: GatewayEnv): Promise<Response> {
      const url = new URL(request.url);
      const ready = configured(env, url.origin);
      if (url.pathname === "/health" && request.method === "GET" && !url.search)
        return reply(
          {
            schemaVersion: 1,
            service: "hambazi-cloudflare-gateway",
            configured: ready,
            forwardingEnabled: env.GATEWAY_ENABLED === "true",
          },
          ready ? 200 : 503,
        );
      const apiMethod = /^\/v1\/([A-Za-z][A-Za-z0-9_]{0,63})$/.exec(url.pathname)?.[1];
      if (url.search || (url.pathname !== "/webhook" && (!apiMethod || !methods.has(apiMethod))))
        return reply({ ok: false, error: "NOT_FOUND" }, 404);
      if (request.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      if (!ready) return reply({ ok: false, error: "UNAVAILABLE" }, 503);
      const webhook = url.pathname === "/webhook";
      const derived =
        webhook && !env.TELEGRAM_WEBHOOK_SECRET
          ? Array.from(await digest("telegram-webhook-v1:" + env.BOT_TOKEN), (v) =>
              v.toString(16).padStart(2, "0"),
            ).join("")
          : undefined;
      const expected = webhook
        ? (env.TELEGRAM_WEBHOOK_SECRET ?? derived!)
        : env.PROXY_SHARED_SECRET;
      const header = webhook ? "x-telegram-bot-api-secret-token" : "x-hambazi-proxy-key";
      if (!(await equalSecret(request.headers.get(header), expected)))
        return reply({ ok: false, error: "UNAUTHENTICATED" }, 401);
      let body: string;
      try {
        body = await boundedBody(
          request,
          webhook ? 65536 : 32768,
          AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
        );
        if (webhook) {
          const parsed: unknown = JSON.parse(body);
          if (
            !parsed ||
            typeof parsed !== "object" ||
            !Number.isSafeInteger((parsed as { update_id?: unknown }).update_id) ||
            Number((parsed as { update_id: number }).update_id) < 0
          )
            throw new Error("INVALID_UPDATE");
        }
      } catch {
        return reply({ ok: false, error: "INVALID_INPUT" }, 400);
      }
      const forwarding = webhook && env.GATEWAY_ENABLED === "true";
      const standalone = webhook && !forwarding;
      if (standalone) {
        const payload = standaloneReply(JSON.parse(body));
        if (!payload) return reply({ ok: true });
        body = JSON.stringify(payload);
      }
      const target = forwarding
        ? env.VPS_WEBHOOK_URL
        : `https://api.telegram.org/bot${env.BOT_TOKEN}/${standalone ? "sendMessage" : apiMethod}`;
      try {
        const response = await transport(target, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...(forwarding ? { "x-telegram-bot-api-secret-token": env.VPS_WEBHOOK_SECRET } : {}),
          },
          body,
          redirect: "error",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(webhook ? 30000 : 8000)]),
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new Error("REDIRECT_REJECTED");
        }
        const text = await boundedBody(response, 65536);
        if (standalone) {
          const result = JSON.parse(text) as { ok?: unknown; error_code?: number };
          if (
            result.ok === true ||
            (result.error_code &&
              result.error_code >= 400 &&
              result.error_code < 500 &&
              ![401, 429].includes(result.error_code))
          )
            return reply({ ok: true });
          return reply({ ok: false, error: "UPSTREAM_UNAVAILABLE" }, 503);
        }
        if (forwarding) {
          const result: unknown = JSON.parse(text);
          if (
            response.status !== 200 ||
            !result ||
            typeof result !== "object" ||
            (result as { ok?: unknown }).ok !== true
          )
            return reply({ ok: false, error: "ORIGIN_NOT_COMPLETED" }, 503);
          return reply({ ok: true });
        }
        return new Response(text, {
          status: response.status,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      } catch {
        // No token/URL/body/raw-error telemetry and no retry of ambiguous sends.
        return reply({ ok: false, error: "UPSTREAM_UNAVAILABLE" }, webhook ? 503 : 502);
      }
    },
  };
}

export default createGateway();

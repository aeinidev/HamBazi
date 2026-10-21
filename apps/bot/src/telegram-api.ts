import { Api } from "grammy";
import { createRelayTransport } from "./relay-transport.js";

export interface TelegramApiOptions {
  token: { reveal(): string };
  timeoutMs: number;
  telegramProxy?: { origin: string; key: { reveal(): string } };
}

type ApiFetch = NonNullable<NonNullable<ConstructorParameters<typeof Api>[1]>["fetch"]>;

/** An opt-in, fixed-origin JSON relay. No global fetch mutation or direct fallback. */
export function createTelegramApi(options: TelegramApiOptions, transport = createRelayTransport()) {
  const common = {
    timeoutSeconds: options.timeoutMs / 1000,
    canUseWebhookReply: () => false,
    sensitiveLogs: false,
    baseFetchConfig: { redirect: "error" as const, size: 65536 },
  };
  if (!options.telegramProxy) return new Api(options.token.reveal(), common);
  const proxy = options.telegramProxy;
  const origin = new URL(proxy.origin);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== proxy.origin ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(proxy.key.reveal())
  )
    throw new Error("Invalid Telegram relay configuration");
  const relayFetch = async (
    ...[input, init]: Parameters<ApiFetch>
  ): Promise<Awaited<ReturnType<ApiFetch>>> => {
    const target = new URL(String(input));
    if (
      target.origin !== origin.origin ||
      target.search ||
      target.hash ||
      !/^\/v1\/[A-Za-z][A-Za-z0-9_]{0,63}$/.test(target.pathname) ||
      init?.method !== "POST" ||
      typeof init.body !== "string" ||
      Buffer.byteLength(init.body) > 32768
    )
      throw new Error("Unsupported Telegram relay request");
    // grammY's Node client uses the legacy abort-controller package. Bridge its
    // event interface into a native signal, including response-body consumption.
    const controller = new AbortController();
    const abort = () => controller.abort();
    init.signal?.addEventListener("abort", abort, { once: true });
    if (init.signal?.aborted) abort();
    try {
      const response = await transport(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-hambazi-proxy-key": proxy.key.reveal(),
        },
        body: init.body,
        redirect: "error",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(options.timeoutMs)]),
      });
      if (
        (response.status >= 300 && response.status < 400) ||
        response.headers.get("content-type")?.split(";")[0] !== "application/json"
      ) {
        await response.body?.cancel();
        throw new Error("Invalid Telegram relay response");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Invalid Telegram relay response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 65536) {
          await reader.cancel();
          throw new Error("Telegram relay response too large");
        }
        chunks.push(chunk.value);
      }
      // The SDK consumes only Response.json(). Native and node-fetch Response
      // have that behavior in common, despite incompatible declaration details.
      return new Response(Buffer.concat(chunks), {
        status: response.status,
        headers: { "content-type": "application/json" },
      }) as unknown as Awaited<ReturnType<ApiFetch>>;
    } finally {
      init.signal?.removeEventListener("abort", abort);
    }
  };
  return new Api(options.token.reveal(), {
    ...common,
    apiRoot: origin.origin,
    // The Telegram token is deliberately absent from the relay URL and headers.
    buildUrl: (root, _token, method) => `${root}/v1/${method}`,
    // node-fetch's declaration merges static exports into typeof fetch; grammY
    // invokes only its callable surface, exercised by the actual SDK tests.
    fetch: relayFetch as ApiFetch,
  });
}

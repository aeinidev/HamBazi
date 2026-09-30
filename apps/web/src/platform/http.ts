import type { z } from "zod";
import { ClientError, failure } from "./errors.js";
export function createHttp(
  origin: string,
  token: () => string | null,
  expired: () => void,
  fetcher: typeof fetch = fetch,
) {
  return async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
    authenticated = true,
    signal?: AbortSignal,
  ): Promise<T> {
    const credential = authenticated ? token() : null;
    if (authenticated && !credential) throw new ClientError("UNAUTHENTICATED");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 15000);
    try {
      const response = await fetcher(new URL(path, origin), {
        method,
        headers: {
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      // Avoid unbounded response allocation, including on error paths.
      const reader = response.body?.getReader();
      if (!reader) throw new ClientError("INVALID_RESPONSE");
      let text = "";
      let size = 0;
      const decoder = new TextDecoder();
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1048576) {
          await reader.cancel();
          throw new ClientError("INVALID_RESPONSE");
        }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new ClientError("INVALID_RESPONSE");
      }
      if (authenticated && token() !== credential) throw new ClientError("UNAUTHENTICATED");
      const error = failure(data);
      if (response.status === 401 && authenticated) {
        if (token() === credential) expired();
        throw new ClientError("UNAUTHENTICATED");
      }
      if (error) throw error;
      if (!response.ok) throw new ClientError("INTERNAL_ERROR", response.status >= 500);
      const parsed = schema.safeParse(data);
      if (!parsed.success) throw new ClientError("INVALID_RESPONSE");
      return parsed.data;
    } catch (error) {
      if (error instanceof ClientError) throw error;
      throw new ClientError("NETWORK_ERROR", true);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  };
}

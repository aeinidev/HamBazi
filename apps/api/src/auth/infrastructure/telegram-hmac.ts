import { createHmac, timingSafeEqual } from "node:crypto";
import { createErrorEnvelope } from "@hambazi/contracts";
import { z } from "zod";
import type { TelegramVerifier } from "../application/telegram-verifier.js";
import type { TelegramIdentity, TelegramVerificationPolicy } from "../domain/telegram-identity.js";

const userSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  photo_url: z.unknown().optional(),
});
function trustedPhotoUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.hostname === "t.me" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith("/i/userpic/")
    )
      return url.href;
  } catch {
    /* An optional photo never affects identity verification. */
  }
}

function parameters(raw: string, maxFields: number): Map<string, string> | undefined {
  const entries = raw.split("&");
  if (entries.length > maxFields) return;
  const result = new Map<string, string>();
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator < 1) return;
    // Unlike URLSearchParams, decodeURIComponent rejects malformed percent/UTF-8 input.
    const name = decodeURIComponent(entry.slice(0, separator).replaceAll("+", " "));
    const value = decodeURIComponent(entry.slice(separator + 1).replaceAll("+", " "));
    if (!/^[a-z][a-z0-9_]*$/.test(name) || result.has(name)) return;
    // Prevent ambiguity in Telegram's newline-separated canonical representation.
    if (value.includes("\n") || value.includes("\r") || value.includes("\0")) return;
    result.set(name, value);
  }
  return result;
}

export function telegramHmacVerifier(
  botToken: { reveal(): string },
  options: TelegramVerificationPolicy,
): TelegramVerifier {
  // Snapshot caller policy. Configuration failures are fixed messages, never raw values.
  const policy = Object.freeze({ ...options });
  if (
    !Number.isSafeInteger(policy.maxAgeSeconds) ||
    policy.maxAgeSeconds < 1 ||
    !Number.isSafeInteger(policy.maxFutureSkewSeconds) ||
    policy.maxFutureSkewSeconds < 0 ||
    !Number.isSafeInteger(policy.maxBytes) ||
    policy.maxBytes < 1 ||
    !Number.isSafeInteger(policy.maxFields) ||
    policy.maxFields < 3
  )
    throw new Error("Invalid Telegram verification policy");

  let secret: Buffer;
  try {
    const token = botToken.reveal();
    if (typeof token !== "string" || !/^[1-9][0-9]*:[A-Za-z0-9_-]+$/.test(token)) {
      throw new Error("Invalid token configuration");
    }
    // Telegram HMAC mode: key = "WebAppData", message = the bot token, raw binary digest.
    secret = createHmac("sha256", "WebAppData").update(token, "utf8").digest();
  } catch {
    throw new Error("Invalid Telegram verifier configuration");
  }

  return Object.freeze({
    verify(initData: unknown, nowMs: number) {
      const rejected = () => createErrorEnvelope("UNAUTHENTICATED");
      try {
        if (
          typeof initData !== "string" ||
          initData.length === 0 ||
          initData.length > policy.maxBytes ||
          Buffer.byteLength(initData, "utf8") > policy.maxBytes ||
          /[\uD800-\uDFFF]/u.test(initData) ||
          !Number.isSafeInteger(nowMs) ||
          nowMs < 0
        )
          return rejected();
        const fields = parameters(initData, policy.maxFields);
        const hash = fields?.get("hash");
        if (!fields || !hash || !/^[0-9a-fA-F]{64}$/.test(hash)) return rejected();
        // Include every other signed field, including unknown additive fields and signature.
        // Excluding signature is the distinct third-party Ed25519 protocol, not HMAC mode.
        const dataCheckString = [...fields]
          .filter(([name]) => name !== "hash")
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([name, value]) => `${name}=${value}`)
          .join("\n");
        const expected = createHmac("sha256", secret).update(dataCheckString, "utf8").digest();
        const received = Buffer.from(hash, "hex");
        // Both buffers are exactly 32 bytes; only the digest comparison is constant-time.
        if (!timingSafeEqual(expected, received)) return rejected();

        const date = fields.get("auth_date");
        if (!date || !/^(?:0|[1-9][0-9]*)$/.test(date)) return rejected();
        const authDate = Number(date);
        const now = Math.floor(nowMs / 1000);
        if (
          !Number.isSafeInteger(authDate) ||
          authDate - now > policy.maxFutureSkewSeconds ||
          now - authDate > policy.maxAgeSeconds
        )
          return rejected();
        const user = userSchema.safeParse(JSON.parse(fields.get("user") ?? "null"));
        if (!user.success) return rejected();
        const startParam = fields.get("start_param");
        const photoUrl = trustedPhotoUrl(user.data.photo_url);
        // Signed routing hint only, never an authorization/admission token.
        const identity: TelegramIdentity = Object.freeze({
          telegramUserId: String(user.data.id),
          authDate,
          ...(startParam !== undefined ? { startParam } : {}),
          ...(photoUrl ? { photoUrl } : {}),
        });
        return { ok: true as const, identity };
      } catch {
        // No raw input, JSON/Zod issue, custom message, or original cause escapes.
        return rejected();
      }
    },
  });
}

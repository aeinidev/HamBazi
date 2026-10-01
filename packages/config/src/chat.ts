import { z } from "zod";
/** Explicit opt-in policy; no public activation or retention setting is inferred. */
export function parseChatConfig(env: Readonly<Record<string, string | undefined>>) {
  const keys = [
    "CHAT_MESSAGE_LIMIT",
    "CHAT_PAGE_LIMIT",
    "CHAT_SEND_LIMIT",
    "CHAT_READ_LIMIT",
  ] as const;
  if (keys.every((key) => env[key] === undefined)) return undefined;
  const integer = (max: number) =>
    z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(max));
  const parsed = z
    .object({
      CHAT_MESSAGE_LIMIT: integer(500),
      CHAT_PAGE_LIMIT: integer(50),
      CHAT_SEND_LIMIT: integer(10),
      CHAT_READ_LIMIT: integer(60),
    })
    .safeParse(env);
  if (!parsed.success) throw new Error("Chat configuration is invalid");
  return Object.freeze({
    policy: {
      messageLimit: parsed.data.CHAT_MESSAGE_LIMIT,
      pageLimit: parsed.data.CHAT_PAGE_LIMIT,
    },
    sendLimit: parsed.data.CHAT_SEND_LIMIT,
    readLimit: parsed.data.CHAT_READ_LIMIT,
  });
}

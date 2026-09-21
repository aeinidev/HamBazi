import { z } from "zod";
import type { OnboardingUpdate } from "./backend.js";
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const messageId = z.number().int().positive().max(2147483647);
const sender = z.object({ id, is_bot: z.boolean() });
const chat = z.object({ id, type: z.literal("private") });
const message = z.object({
  message_id: messageId,
  from: sender,
  chat,
  text: z.string().max(4096),
  reply_to_message: z.object({ message_id: messageId, from: sender, chat }).optional(),
  via_bot: z.unknown().optional(),
  forward_origin: z.unknown().optional(),
  sender_chat: z.unknown().optional(),
  business_connection_id: z.unknown().optional(),
});
export const updateEnvelope = z.object({
  update_id: z.number().int().nonnegative().max(2147483647),
});
/** Map only original private text messages. Business rules and prompt eligibility remain in Auth. */
export function mapUpdate(
  input: unknown,
  botId: string,
  username: string,
): OnboardingUpdate | undefined {
  const envelope = updateEnvelope.safeParse(input);
  if (!envelope.success) return;
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some((k) => k !== "update_id" && k !== "message")) return;
  const parsed = message.safeParse(raw.message);
  if (!parsed.success) return;
  const m = parsed.data;
  if (
    m.from.is_bot ||
    m.from.id !== m.chat.id ||
    ["via_bot", "forward_origin", "sender_chat", "business_connection_id"].some((k) =>
      Object.hasOwn(m, k),
    )
  )
    return;
  const base = {
    schemaVersion: 1 as const,
    updateId: envelope.data.update_id,
    senderId: String(m.from.id),
    chatId: String(m.chat.id),
    chatType: "private" as const,
    messageId: m.message_id,
  };
  const command =
    /^\/(start|create|cancel)(?:@([A-Za-z0-9_]+))?(?:\s+([A-Za-z0-9_-]{1,512}))?$/.exec(m.text);
  if (
    command &&
    (!command[2] || command[2].toLowerCase() === username.toLowerCase()) &&
    (!command[3] || command[1] === "start")
  )
    return {
      ...base,
      action: command[1] === "start" ? "START" : command[1] === "create" ? "CREATE" : "CANCEL",
    };
  // Reply keyboard labels are intents, never user IDs or account attributes.
  if (m.text === "Create Account") return { ...base, action: "CREATE" };
  if (m.text === "Cancel") return { ...base, action: "CANCEL" };
  const reply = m.reply_to_message;
  if (
    m.text.startsWith("/") ||
    !reply ||
    !reply.from.is_bot ||
    String(reply.from.id) !== botId ||
    reply.chat.id !== m.chat.id ||
    m.text.length > 256
  )
    return;
  return { ...base, action: "NAME", replyToMessageId: reply.message_id, displayName: m.text };
}

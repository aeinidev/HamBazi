import { z } from "zod";
const counter = z.number().int().min(0).max(2147483647);
const text = z
  .string()
  .max(1000)
  .refine(
    (value) =>
      [...value].length <= 500 &&
      [...value].every(
        (character) =>
          !/[\p{Cc}\p{Cs}]/u.test(character) &&
          (!/\p{Cf}/u.test(character) || character === "\u200c" || character === "\u200d"),
      ) &&
      /[^\p{White_Space}\p{Default_Ignorable_Code_Point}]/u.test(value),
  );
export const chatMessageSchema = z.object({
  schemaVersion: z.literal(1),
  messageId: z.uuid(),
  matchId: z.uuid(),
  userId: z.uuid(),
  seq: counter.min(1),
  text,
  createdAt: z.number().int().nonnegative().max(8640000000000000),
});
export const chatPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    matchId: z.uuid(),
    role: z.enum(["PLAYER", "SPECTATOR"]),
    canSend: z.boolean(),
    messageLimit: z.number().int().min(1).max(500),
    messages: z.array(chatMessageSchema).max(50),
    lastSeq: counter,
    hasMore: z.boolean(),
  })
  .refine(
    (page) =>
      page.canSend === (page.role === "PLAYER") &&
      page.messages.every(
        (message, index) =>
          message.matchId === page.matchId &&
          message.seq <= page.lastSeq &&
          (index === 0 || message.seq === page.messages[index - 1]!.seq + 1),
      ) &&
      new Set(page.messages.map((message) => message.messageId)).size === page.messages.length,
  );
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export function createChatFeed(matchId: string) {
  let messages: ChatMessage[] = [];
  let cursor = 0;
  function merge(values: ChatMessage[]) {
    messages = [
      ...new Map([...messages, ...values].map((message) => [message.seq, message])).values(),
    ]
      .sort((a, b) => a.seq - b.seq)
      .slice(-200);
  }
  return {
    cursor: () => cursor,
    messages: () => [...messages],
    clear() {
      messages = [];
      cursor = 0;
    },
    page(input: unknown, mode: "latest" | "older" | "after") {
      const parsed = chatPageSchema.safeParse(input);
      if (!parsed.success || parsed.data.matchId !== matchId) return null;
      const page = parsed.data;
      // A live delivery can overtake a history request. Never discard it or
      // regress the cursor when the older response eventually arrives.
      if (mode === "latest") {
        messages = messages.filter((message) => message.seq > page.lastSeq);
        cursor = Math.max(cursor, page.lastSeq);
      } else if (mode === "after" && page.messages.length && page.messages[0]!.seq > cursor + 1)
        return null;
      else if (
        mode === "after" &&
        !page.hasMore &&
        page.lastSeq > cursor &&
        page.messages.at(-1)?.seq !== page.lastSeq
      )
        return null;
      else if (
        mode === "older" &&
        page.messages.length &&
        messages.length &&
        page.messages.at(-1)!.seq !== messages[0]!.seq - 1
      )
        return null;
      merge(page.messages);
      if (mode === "after")
        cursor = Math.max(
          cursor,
          page.hasMore ? (page.messages.at(-1)?.seq ?? cursor) : page.lastSeq,
        );
      return page;
    },
    event(input: unknown) {
      const parsed = chatMessageSchema.safeParse(input);
      if (!parsed.success || parsed.data.matchId !== matchId) return "INVALID" as const;
      const message = parsed.data;
      if (message.seq <= cursor) return "DUPLICATE" as const;
      if (message.seq !== cursor + 1) return "GAP" as const;
      merge([message]);
      cursor = message.seq;
      return "APPLY" as const;
    },
  };
}

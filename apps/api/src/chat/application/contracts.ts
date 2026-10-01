import { matchCorrelationSchema } from "../../matches/index.js";
import { z } from "zod";
const uuid = z.uuid().transform((value) => value.toLowerCase());
const counter = z.number().int().min(0).max(2147483647);
export const chatTextSchema = z
  .string()
  .max(4096)
  .refine((value) =>
    [...value].every(
      (character) =>
        !/[\p{Cc}\p{Cs}]/u.test(character) &&
        (!/\p{Cf}/u.test(character) || character === "\u200c" || character === "\u200d"),
    ),
  )
  .transform((value) => value.normalize("NFC").trim())
  .refine(
    (value) =>
      [...value].length <= 500 && /[^\p{White_Space}\p{Default_Ignorable_Code_Point}]/u.test(value),
  );
export const chatSendSchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: uuid,
  commandId: uuid,
  text: chatTextSchema,
});
export const chatListSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    matchId: uuid,
    limit: z.number().int().min(1).max(50).optional(),
    beforeSeq: counter.min(1).optional(),
    afterSeq: counter.optional(),
  })
  .refine((value) => value.beforeSeq === undefined || value.afterSeq === undefined);
export const chatMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: uuid,
  messageId: uuid,
  userId: uuid,
  seq: counter.min(1),
  text: chatTextSchema,
  createdAt: z.number().int().nonnegative().max(8640000000000000),
});
export const chatPageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: uuid,
  role: z.enum(["PLAYER", "SPECTATOR"]),
  canSend: z.boolean(),
  messageLimit: z.number().int().min(1).max(500),
  messages: z.array(chatMessageSchema).max(50),
  lastSeq: counter,
  hasMore: z.boolean(),
});
export const chatDeliverySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    eventId: uuid,
    aggregateId: uuid,
    occurredAt: z.number().int().nonnegative(),
    type: z.literal("CHAT_MESSAGE_V1"),
    correlation: matchCorrelationSchema,
    payload: z.strictObject({
      schemaVersion: z.literal(1),
      matchId: uuid,
      messageId: uuid,
      seq: counter.min(1),
    }),
  })
  .refine((value) => value.aggregateId === value.payload.matchId);
export const chatPolicySchema = z.strictObject({
  messageLimit: z.number().int().min(1).max(500),
  pageLimit: z.number().int().min(1).max(50),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatPage = z.infer<typeof chatPageSchema>;
export type ChatDelivery = z.infer<typeof chatDeliverySchema>;
export type ChatPolicy = z.infer<typeof chatPolicySchema>;
export type ChatSend = z.infer<typeof chatSendSchema>;
export type ChatList = z.infer<typeof chatListSchema>;

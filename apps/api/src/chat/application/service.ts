import { createErrorEnvelope } from "@hambazi/contracts";
import { z } from "zod";
import {
  matchCorrelationSchema,
  type MatchCorrelation,
  type MatchMembershipPort,
} from "../../matches/index.js";
import {
  chatDeliverySchema,
  chatListSchema,
  chatPolicySchema,
  chatSendSchema,
  type ChatDelivery,
  type ChatList,
  type ChatMessage,
  type ChatPolicy,
  type ChatSend,
} from "./contracts.js";
export interface ChatRepository {
  send(
    userId: string,
    input: ChatSend,
    correlation: MatchCorrelation,
  ): Promise<ChatMessage | "CONFLICT">;
  list(input: ChatList): Promise<{ messages: ChatMessage[]; lastSeq: number; hasMore: boolean }>;
  message(input: ChatDelivery["payload"]): Promise<ChatMessage | null>;
}
export type ChatRate = (
  userId: string,
  operation: "send" | "list",
) => Promise<{ allowed: true } | { allowed: false; reason: "limited" | "unavailable" }>;
export function chatService(options: {
  repository: ChatRepository;
  membership: MatchMembershipPort;
  rate: ChatRate;
  policy: ChatPolicy;
}) {
  const policy = chatPolicySchema.parse(options.policy);
  async function authorize(userId: string, matchId: string, sending = false) {
    const result = await options.membership.authorize(userId, { schemaVersion: 1, matchId });
    if (!result.ok) return result;
    if (sending && result.value.role !== "PLAYER") return createErrorEnvelope("FORBIDDEN");
    return result;
  }
  async function admission(userId: string, matchId: string, kind: "send" | "list") {
    const member = await authorize(userId, matchId, kind === "send");
    if (!member.ok) return member;
    const rate = await options.rate(userId, kind);
    if (!rate.allowed)
      return createErrorEnvelope(rate.reason === "limited" ? "RATE_LIMITED" : "INTERNAL_ERROR");
    // Role may change while awaiting distributed admission.
    return authorize(userId, matchId, kind === "send");
  }
  return Object.freeze({
    async send(identity: unknown, input: unknown, correlation: unknown = {}) {
      const actor = z
        .uuid()
        .transform((value) => value.toLowerCase())
        .safeParse(identity);
      const parsed = chatSendSchema.safeParse(input);
      const context = matchCorrelationSchema.safeParse(correlation);
      if (!actor.success) return createErrorEnvelope("UNAUTHENTICATED");
      if (!context.success || !parsed.success || [...parsed.data.text].length > policy.messageLimit)
        return createErrorEnvelope("INVALID_INPUT");
      try {
        const member = await admission(actor.data, parsed.data.matchId, "send");
        if (!member.ok) return member;
        const message = await options.repository.send(actor.data, parsed.data, context.data);
        return message === "CONFLICT"
          ? createErrorEnvelope("CHAT_CONFLICT")
          : { ok: true as const, value: message };
      } catch {
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
    async list(identity: unknown, input: unknown) {
      const actor = z
        .uuid()
        .transform((value) => value.toLowerCase())
        .safeParse(identity);
      const parsed = chatListSchema.safeParse(input);
      if (!actor.success) return createErrorEnvelope("UNAUTHENTICATED");
      if (!parsed.success || (parsed.data.limit ?? policy.pageLimit) > policy.pageLimit)
        return createErrorEnvelope("INVALID_INPUT");
      try {
        const member = await admission(actor.data, parsed.data.matchId, "list");
        if (!member.ok) return member;
        const page = await options.repository.list({
          ...parsed.data,
          limit: parsed.data.limit ?? policy.pageLimit,
        });
        return {
          ok: true as const,
          value: {
            schemaVersion: 1 as const,
            matchId: parsed.data.matchId,
            role: member.value.role,
            canSend: member.value.role === "PLAYER",
            messageLimit: policy.messageLimit,
            ...page,
          },
        };
      } catch {
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
    async delivery(identity: unknown, input: unknown) {
      const actor = z
        .uuid()
        .transform((value) => value.toLowerCase())
        .safeParse(identity);
      const event = chatDeliverySchema.safeParse(input);
      if (!actor.success) return createErrorEnvelope("UNAUTHENTICATED");
      if (!event.success) return createErrorEnvelope("INVALID_INPUT");
      try {
        const member = await authorize(actor.data, event.data.aggregateId);
        if (!member.ok) return member;
        const message = await options.repository.message(event.data.payload);
        return message ? { ok: true as const, value: message } : createErrorEnvelope("NOT_FOUND");
      } catch {
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
  });
}
export type ChatPort = ReturnType<typeof chatService>;

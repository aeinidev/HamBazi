import { expect, it, vi } from "vitest";
import { createErrorEnvelope } from "@hambazi/contracts";
import {
  chatTextSchema,
  chatSendSchema,
  chatListSchema,
  chatDeliverySchema,
} from "../../src/chat/index.js";
import { chatService } from "../../src/chat/application/service.js";
const userId = "11111111-1111-4111-8111-111111111111";
const matchId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const message = {
  schemaVersion: 1 as const,
  userId,
  matchId,
  messageId: commandId,
  text: "سلام 👋",
  seq: 1,
  createdAt: 1000,
};
const event = {
  schemaVersion: 1,
  eventId: commandId,
  aggregateId: matchId,
  occurredAt: 1000,
  type: "CHAT_MESSAGE_V1",
  correlation: {},
  payload: { schemaVersion: 1, matchId, messageId: commandId, seq: 1 },
};
function fixture() {
  const authorize = vi.fn(async () => ({
    ok: true as const,
    value: { schemaVersion: 1 as const, matchId, role: "PLAYER" as "PLAYER" | "SPECTATOR" },
  }));
  const rate = vi.fn(async () => ({ allowed: true as const }));
  const send = vi.fn(async () => message);
  const list = vi.fn(async () => ({ messages: [message], lastSeq: 1, hasMore: false }));
  const service = chatService({
    membership: { authorize },
    rate,
    policy: { messageLimit: 500, pageLimit: 50 },
    repository: { send, list, message: async () => message },
  });
  return { service, authorize, rate, send, list };
}
it.each([
  "",
  "   ",
  "\u200c",
  "\u200btext",
  "bad\nline",
  "\u202eevil",
  "\u061c",
  "\ud800",
  "\udfff",
  "a".repeat(501),
  "a".repeat(4097),
])("rejects unsafe/empty/oversized text fixture %$", (text) => {
  expect(chatTextSchema.safeParse(text).success).toBe(false);
});
it("normalizes Unicode without interpreting plain-text markup, Persian or emoji", () => {
  expect(chatTextSchema.parse("  e\u0301 👩‍💻 می‌خواهم <img src=x onerror=alert(1)>  ")).toBe(
    "é 👩‍💻 می‌خواهم <img src=x onerror=alert(1)>",
  );
  expect(chatTextSchema.safeParse("😀".repeat(500)).success).toBe(true);
});
it("rejects forged identity, extras, combined cursors and oversized pages before work", async () => {
  const f = fixture();
  expect(
    chatSendSchema.safeParse({ schemaVersion: 1, matchId, commandId, text: "hi", userId }).success,
  ).toBe(false);
  for (const input of [
    { schemaVersion: 2, matchId },
    { schemaVersion: 1, matchId, beforeSeq: 1, afterSeq: 0 },
    { schemaVersion: 1, matchId, limit: 51 },
  ])
    expect(chatListSchema.safeParse(input).success).toBe(false);
  expect(await f.service.send("forged", {})).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  expect(f.authorize).not.toHaveBeenCalled();
});
it("binds send to current membership, forwards only normalized intent/correlation and never reads state", async () => {
  const f = fixture();
  expect(
    await f.service.send(
      userId,
      { schemaVersion: 1, matchId, commandId, text: "  سلام 👋  " },
      { requestId: commandId },
    ),
  ).toEqual({ ok: true, value: message });
  expect(f.authorize).toHaveBeenCalledTimes(2);
  expect(f.send).toHaveBeenCalledWith(
    userId,
    { schemaVersion: 1, matchId, commandId, text: "سلام 👋" },
    { requestId: commandId },
  );
});
it("allows spectator history/delivery but denies sending, including role change during admission", async () => {
  const f = fixture();
  f.authorize.mockResolvedValue({
    ok: true,
    value: { schemaVersion: 1, matchId, role: "SPECTATOR" },
  });
  expect(await f.service.list(userId, { schemaVersion: 1, matchId })).toMatchObject({
    ok: true,
    value: { canSend: false },
  });
  expect(await f.service.delivery(userId, event)).toEqual({ ok: true, value: message });
  expect(
    await f.service.send(userId, { schemaVersion: 1, matchId, commandId, text: "hi" }),
  ).toMatchObject({ error: { code: "FORBIDDEN" } });
  f.authorize.mockResolvedValueOnce({
    ok: true,
    value: { schemaVersion: 1, matchId, role: "PLAYER" },
  });
  expect(
    await f.service.send(userId, { schemaVersion: 1, matchId, commandId, text: "hi" }),
  ).toMatchObject({ error: { code: "FORBIDDEN" } });
  expect(f.send).not.toHaveBeenCalled();
});
it("fails closed on nonmembership/rate/database errors without exposing content or raw causes", async () => {
  const f = fixture();
  f.authorize.mockImplementationOnce(async () => {
    throw new Error("PRIVATE_CHAT");
  });
  expect(JSON.stringify(await f.service.list(userId, { schemaVersion: 1, matchId }))).not.toContain(
    "PRIVATE_CHAT",
  );
  f.authorize.mockImplementationOnce(async () => createErrorEnvelope("NOT_FOUND") as never);
  expect(await f.service.list(userId, { schemaVersion: 1, matchId })).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  f.rate.mockImplementationOnce(async () => ({ allowed: false, reason: "limited" }) as never);
  expect(
    await f.service.send(userId, { schemaVersion: 1, matchId, commandId, text: "hi" }),
  ).toMatchObject({ error: { code: "RATE_LIMITED" } });
  f.rate.mockImplementationOnce(async () => ({ allowed: false, reason: "unavailable" }) as never);
  expect(await f.service.list(userId, { schemaVersion: 1, matchId })).toMatchObject({
    error: { code: "INTERNAL_ERROR" },
  });
  expect(f.send).not.toHaveBeenCalled();
  f.send.mockImplementationOnce(async () => "CONFLICT" as never);
  expect(
    await f.service.send(userId, { schemaVersion: 1, matchId, commandId, text: "hi" }),
  ).toMatchObject({ error: { code: "CHAT_CONFLICT" } });
});
it("forbids text/state in durable wakeups and rejects wrong Match/correlation", () => {
  expect(chatDeliverySchema.safeParse(event).success).toBe(true);
  expect(
    chatDeliverySchema.safeParse({ ...event, payload: { ...event.payload, text: "PRIVATE" } })
      .success,
  ).toBe(false);
  expect(chatDeliverySchema.safeParse({ ...event, aggregateId: commandId }).success).toBe(false);
  expect(
    chatDeliverySchema.safeParse({
      ...event,
      correlation: { traceparent: "00-" + "0".repeat(32) + "-" + "0".repeat(16) + "-01" },
    }).success,
  ).toBe(false);
});

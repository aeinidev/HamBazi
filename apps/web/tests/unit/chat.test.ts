import { expect, it } from "vitest";
import { createChatFeed, chatPageSchema } from "../../src/features/chat/index.js";
const matchId = "11111111-1111-4111-8111-111111111111";
const id = (seq: number) => `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
const message = (seq: number) => ({
  schemaVersion: 1,
  matchId,
  messageId: id(seq),
  userId: matchId,
  seq,
  text: "<img src=x onerror=alert(1)>",
  createdAt: 1000,
});
const page = (first: number, last: number, lastSeq = last) => ({
  schemaVersion: 1,
  matchId,
  canSend: true,
  role: "PLAYER",
  messageLimit: 500,
  messages: Array.from({ length: last - first + 1 }, (_, i) => message(first + i)),
  lastSeq,
  hasMore: false,
});
it("deduplicates delivery, detects gaps and accepts ordered catch-up independently of game versions", () => {
  const feed = createChatFeed(matchId);
  expect(feed.page(page(1, 2), "latest")).not.toBeNull();
  expect(feed.event(message(2))).toBe("DUPLICATE");
  expect(feed.event(message(4))).toBe("GAP");
  expect(feed.cursor()).toBe(2);
  expect(feed.page(page(3, 4), "after")).not.toBeNull();
  expect(feed.event(message(5))).toBe("APPLY");
  expect(feed.messages().map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
});
it("rejects foreign, malformed and inconsistent history or spectator permissions", () => {
  const feed = createChatFeed(matchId);
  expect(feed.event({ ...message(1), matchId: id(2) })).toBe("INVALID");
  expect(feed.page({ ...page(1, 2), messages: [message(2), message(1)] }, "latest")).toBeNull();
  expect(feed.page(page(4, 5), "after")).toBeNull();
  expect(chatPageSchema.safeParse({ ...page(1, 2), role: "SPECTATOR" }).success).toBe(false);
  expect(feed.event({ ...message(1), text: "\u202eunsafe" })).toBe("INVALID");
});
it("caps memory, keeps plain text and clears history on lifecycle disposal", () => {
  const feed = createChatFeed(matchId);
  feed.page(page(1, 1), "latest");
  for (let seq = 2; seq <= 250; seq++) expect(feed.event(message(seq))).toBe("APPLY");
  expect(feed.messages()).toHaveLength(200);
  expect(feed.messages()[0]!.seq).toBe(51);
  expect(feed.messages()[0]!.text).toContain("<img");
  feed.clear();
  expect(feed.messages()).toEqual([]);
  expect(feed.cursor()).toBe(0);
});
it("accepts earlier keyset pages without resetting the live cursor", () => {
  const feed = createChatFeed(matchId);
  feed.page(page(51, 100), "latest");
  expect(feed.page(page(1, 50, 100), "older")).not.toBeNull();
  expect(feed.cursor()).toBe(100);
  expect(feed.messages()).toHaveLength(100);
  expect(feed.event(message(101))).toBe("APPLY");
});
it("preserves live deliveries that overtake history responses", () => {
  const feed = createChatFeed(matchId);
  expect(feed.event(message(1))).toBe("APPLY");
  expect(feed.page(page(1, 0, 0), "latest")).not.toBeNull();
  expect(feed.cursor()).toBe(1);
  expect(feed.messages()).toEqual([message(1)]);
  expect(feed.event(message(2))).toBe("APPLY");
  expect(feed.page(page(2, 2), "after")).not.toBeNull();
  expect(feed.page(page(1, 1), "latest")).not.toBeNull();
  expect(feed.page(page(1, 0, 1), "after")).not.toBeNull();
  expect(feed.cursor()).toBe(2);
  expect(feed.messages().map((value) => value.seq)).toEqual([1, 2]);
});

import { describe, it, expect } from "vitest";
import { mapUpdate } from "../../src/updates.js";
import { raw, name } from "./fixtures.js";
const map = (input: unknown) => mapUpdate(input, "123", "hambazi_test_bot");
describe("original Telegram update mapping", () => {
  it.each([
    ["/start", "START"],
    ["/start room_opaque", "START"],
    ["/start@HamBazi_Test_Bot", "START"],
    ["/create", "CREATE"],
    ["Create Account", "CREATE"],
    ["/cancel", "CANCEL"],
    ["Cancel", "CANCEL"],
  ])("maps explicit %s intent", (text, action) =>
    expect(map(raw(text))).toEqual({
      schemaVersion: 1,
      updateId: 1,
      senderId: "100",
      chatId: "100",
      chatType: "private",
      messageId: 2,
      action,
    }),
  );
  it("preserves raw names verbatim and derives identity from the sender", () =>
    expect(map(name())).toMatchObject({
      action: "NAME",
      displayName: "  Mehdi  ",
      replyToMessageId: 900,
      senderId: "100",
    }));
  it.each([
    "/start@someone_else_bot",
    "/create payload",
    "/unknown",
    "ordinary text",
    "/cancel payload",
  ])("ignores unsupported text %s", (text) => expect(map(raw(text))).toBeUndefined());
  it.each(["edited_message", "channel_post", "business_message", "callback_query"])(
    "ignores %s",
    (key) => expect(map({ update_id: 1, [key]: raw().message })).toBeUndefined(),
  );
  it.each([
    { from: { id: 100, is_bot: true } },
    { chat: { id: 101, type: "private" } },
    { chat: { id: -100, type: "group" } },
    { from: { id: Number.MAX_SAFE_INTEGER + 1, is_bot: false } },
    { via_bot: {} },
    { forward_origin: {} },
    { sender_chat: {} },
    { business_connection_id: "x" },
  ])("rejects unsafe message %#", (fields) =>
    expect(map({ ...raw(), message: { ...raw().message, ...fields } })).toBeUndefined(),
  );
  it.each([
    undefined,
    { message_id: 900, from: { id: 456, is_bot: true }, chat: { id: 100, type: "private" } },
    { message_id: 900, from: { id: 123, is_bot: false }, chat: { id: 100, type: "private" } },
    { message_id: 900, from: { id: 123, is_bot: true }, chat: { id: 101, type: "private" } },
  ])("requires reply to this bot in this chat %#", (reply) =>
    expect(
      map({ ...name(), message: { ...name().message, reply_to_message: reply } }),
    ).toBeUndefined(),
  );
  it("does not truncate oversized names or accept edited ambiguity", () => {
    expect(map(name("x".repeat(257)))).toBeUndefined();
    expect(map({ ...raw(), edited_message: raw().message })).toBeUndefined();
  });
});

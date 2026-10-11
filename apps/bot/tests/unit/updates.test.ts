import { describe, it, expect } from "vitest";
import { mapUpdate } from "../../src/updates.js";
import { raw, name } from "./fixtures.js";
const map = (input: unknown) => mapUpdate(input, "123", "hambazi_test_bot");
describe("verified original private Telegram intents", () => {
  it.each([
    ["/start", "START"],
    ["/start room_opaque", "START"],
    ["/start@HamBazi_Test_Bot", "START"],
    ["/cancel", "CANCEL"],
    ["لغو", "CANCEL"],
    ["Cancel", "CANCEL"],
    ["پروفایل من", "PROFILE"],
    ["ارتباط با پشتیبان", "SUPPORT"],
  ])("maps %s", (text, action) =>
    expect(map(raw(text))).toMatchObject({
      schemaVersion: 1,
      senderId: "100",
      chatId: "100",
      chatType: "private",
      action,
    }),
  );
  it.each(["/create", "ایجاد حساب کاربری", "Create Account"])(
    "derives registration identity and name for %s",
    (text) => {
      const input = raw(text);
      expect(
        map({
          ...input,
          message: {
            ...input.message,
            from: { id: 100, is_bot: false, first_name: "مهدی", last_name: "تست" },
          },
        }),
      ).toMatchObject({ action: "REGISTER", displayName: "مهدی تست", senderId: "100" });
    },
  );
  it("maps a reply to the server-owned name prompt without accepting it automatically", () => {
    expect(map(name())).toMatchObject({
      action: "NAME",
      displayName: "  Mehdi  ",
      replyToMessageId: 900,
    });
    expect(map(raw("ordinary text"))).toMatchObject({ action: "TEXT" });
    expect(map(name("x".repeat(257)))).toMatchObject({
      action: "NAME",
      displayName: "x".repeat(257),
    });
  });
  it.each([
    "/start@someone_else_bot",
    "/create payload",
    "/unknown",
    "/cancel payload",
    "Open",
    "Open HamBazi",
  ])("never submits command/navigation %s as support text", (text) =>
    expect(map(raw(text))).toMatchObject({ action: "NAVIGATION" }),
  );
  it("maps unsupported original media without collecting the media or caption", () => {
    const { text: _text, ...message } = raw().message;
    expect(
      map({
        update_id: 1,
        message: { ...message, photo: [{ file_id: "private" }], caption: "private" },
      }),
    ).toMatchObject({ action: "MEDIA" });
    expect(
      JSON.stringify(map({ update_id: 1, message: { ...message, photo: [{}] } })),
    ).not.toContain("file_id");
  });
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
  it("does not accept edited ambiguity or text beyond Telegram's transport bound", () => {
    expect(map({ ...raw(), edited_message: raw().message })).toBeUndefined();
    expect(map(raw("x".repeat(4097)))).toBeUndefined();
  });
});

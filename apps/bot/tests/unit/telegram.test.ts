import { Api } from "grammy";
import { describe, it, expect, vi } from "vitest";
import { createTelegramSender } from "../../src/telegram.js";
import { delivery } from "./fixtures.js";
const options = {
  token: { reveal: () => `123:${"a".repeat(32)}` },
  miniAppUrl: "https://mini.example/app",
  timeoutMs: 100,
};
describe("grammY bounded outbound messages", () => {
  it.each([
    "CREATE_ACCOUNT",
    "WELCOME_REGISTERED",
    "PROMPT_NAME",
    "INVALID_NAME",
    "MENU",
    "CANCELLED",
    "EXPIRED",
    "DENIED",
  ] as const)("renders safe %s reply", async (reply) => {
    const api = new Api(options.token.reveal());
    const send = vi
      .spyOn(api, "sendMessage")
      .mockResolvedValue({ message_id: 900, chat: { id: 100, type: "private" } } as Awaited<
        ReturnType<Api["sendMessage"]>
      >);
    const photo = vi
      .spyOn(api, "sendPhoto")
      .mockResolvedValue({ message_id: 900, chat: { id: 100, type: "private" } } as Awaited<
        ReturnType<Api["sendPhoto"]>
      >);
    expect(
      await createTelegramSender(options, api).send(
        { ...delivery, reply },
        AbortSignal.timeout(1000),
      ),
    ).toBe(900);
    const payload = send.mock.calls[0]![2]!;
    expect(photo).not.toHaveBeenCalled();
    if (reply === "CREATE_ACCOUNT" || reply === "WELCOME_REGISTERED")
      expect(send.mock.calls[0]![1]).toBe("برای ادامه، از دکمه‌های پایین استفاده کن.");
    expect(payload).not.toHaveProperty("parse_mode");
    if (reply === "PROMPT_NAME" || reply === "INVALID_NAME")
      expect(payload.reply_markup).toHaveProperty("force_reply", true);
    if (reply === "MENU" || reply === "WELCOME_REGISTERED")
      expect(payload.reply_markup).toEqual({
        keyboard: [[{ text: "پروفایل من" }], [{ text: "ارتباط با پشتیبان" }]],
        resize_keyboard: true,
        is_persistent: true,
        one_time_keyboard: false,
      });
    if (reply === "CREATE_ACCOUNT")
      expect(payload.reply_markup).toEqual({
        keyboard: [[{ text: "ایجاد حساب کاربری", style: "primary" }]],
        resize_keyboard: true,
        is_persistent: true,
        one_time_keyboard: false,
      });
  });
  it("sanitizes SDK errors that can include token/payload", async () => {
    const api = new Api(options.token.reveal());
    vi.spyOn(api, "sendMessage").mockRejectedValue(new Error("private token payload"));
    await expect(
      createTelegramSender(options, api).send(delivery, AbortSignal.timeout(1000)),
    ).rejects.toThrow(/^Bot delivery is incomplete$/);
  });
  it("actually propagates timeout into the SDK fetch boundary", async () => {
    const api = new Api(options.token.reveal(), {
      fetch: ((_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })) as NonNullable<NonNullable<ConstructorParameters<typeof Api>[1]>["fetch"]>,
    });
    await expect(
      createTelegramSender(options, api).send(delivery, AbortSignal.timeout(1000)),
    ).rejects.toThrow(/^Bot delivery is incomplete$/);
  });
});

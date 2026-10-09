import { Api } from "grammy";
import { expect, it, vi } from "vitest";
import { configureMiniAppMenu } from "../../src/menu.js";
it.each([
  ["https://mini.example/app", "https://mini.example/app"],
  ["https://mini.example", "https://mini.example/"],
])(
  "replaces default and verified-owner menu overrides with exact Open text (%s)",
  async (requested, returned) => {
    const api = new Api(`123:${"a".repeat(32)}`);
    vi.spyOn(api, "getMe").mockResolvedValue({
      id: 123,
      username: "Hambazidev_bot",
      is_bot: true,
      first_name: "Synthetic",
    } as Awaited<ReturnType<Api["getMe"]>>);
    const menu = {
      type: "web_app" as const,
      text: "Open",
      web_app: { url: requested },
    };
    vi.spyOn(api, "getChatMenuButton")
      .mockResolvedValueOnce({ type: "commands" })
      .mockResolvedValueOnce({ type: "commands" })
      .mockResolvedValue({ ...menu, web_app: { url: returned } });
    const set = vi.spyOn(api, "setChatMenuButton").mockResolvedValue(true);
    expect(
      await configureMiniAppMenu(
        api,
        { username: "Hambazidev_bot", miniAppUrl: menu.web_app.url, ownerChatId: "100" },
        AbortSignal.timeout(1000),
      ),
    ).toMatchObject({ defaultVerified: true, ownerVerified: true });
    expect(set.mock.calls.map((call) => call[0])).toEqual([
      { menu_button: menu },
      { chat_id: 100, menu_button: menu },
    ]);
  },
);
it("fails before menu mutation when bot identity does not match", async () => {
  const api = new Api(`123:${"a".repeat(32)}`);
  vi.spyOn(api, "getMe").mockResolvedValue({ username: "wrong_bot" } as Awaited<
    ReturnType<Api["getMe"]>
  >);
  const set = vi.spyOn(api, "setChatMenuButton");
  await expect(
    configureMiniAppMenu(
      api,
      { username: "Hambazidev_bot", miniAppUrl: "https://mini.example/app", ownerChatId: "100" },
      AbortSignal.timeout(1000),
    ),
  ).rejects.toThrow("Bot identity mismatch");
  expect(set).not.toHaveBeenCalled();
});

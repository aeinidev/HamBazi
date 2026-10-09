import { Api } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { botDescription, configureBotDescription } from "../../src/description.js";
const fixture = () => {
  const api = new Api(`123:${"a".repeat(32)}`);
  const bot = {
    id: 123,
    is_bot: true,
    first_name: "Bot",
    username: "hambazi_test_bot",
  } as Awaited<ReturnType<Api["getMe"]>>;
  const me = vi.spyOn(api, "getMe").mockResolvedValue(bot);
  const descriptions = new Map<string, string>();
  const get = vi.spyOn(api, "getMyDescription").mockImplementation(async (options) => ({
    description: descriptions.get(options?.language_code ?? "") ?? "previous introduction",
  }));
  const set = vi.spyOn(api, "setMyDescription").mockImplementation(async (description, options) => {
    descriptions.set(options?.language_code ?? "", description);
    return true;
  });
  return { api, me, get, set, descriptions };
};
describe("native pre-Start bot introduction", () => {
  it("sets and reads back only the approved default and Persian descriptions", async () => {
    const f = fixture();
    expect(botDescription.length).toBeLessThanOrEqual(512);
    expect(
      await configureBotDescription(f.api, "hambazi_test_bot", AbortSignal.timeout(1000)),
    ).toEqual({ defaultVerified: true, persianVerified: true });
    expect([...f.descriptions.entries()]).toEqual([
      ["", botDescription],
      ["fa", botDescription],
    ]);
    expect(f.get).toHaveBeenCalledTimes(4);
    expect(f.set).toHaveBeenCalledTimes(2);
  });
  it("does not change descriptions for another bot identity", async () => {
    const f = fixture();
    await expect(
      configureBotDescription(f.api, "different_bot", AbortSignal.timeout(1000)),
    ).rejects.toThrow("Bot identity mismatch");
    expect(f.set).not.toHaveBeenCalled();
  });
  it("does not report success when Telegram does not return the requested introduction", async () => {
    const f = fixture();
    f.get.mockResolvedValue({ description: "different introduction" });
    await expect(
      configureBotDescription(f.api, "hambazi_test_bot", AbortSignal.timeout(1000)),
    ).rejects.toThrow("Description verification failed");
  });
});

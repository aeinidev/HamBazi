import { test, expect } from "@playwright/test";

test("local preview supplies only synthetic identity and an isolated session", async ({
  page,
  request,
}) => {
  expect((await request.get("http://127.0.0.1:4174/__test/state")).status()).toBe(404);
  expect((await request.get("http://127.0.0.1:4174/v1/me")).status()).toBe(401);
  await page.goto("/");
  await expect(
    page.getByText("Local preview · synthetic Telegram identity and server data"),
  ).toBeVisible();
  const initData = await page.evaluate(() => window.Telegram?.WebApp?.initData);
  expect(new URLSearchParams(initData).get("preview")).toBe("synthetic");
  expect(JSON.parse(new URLSearchParams(initData).get("user") ?? "{}")).toMatchObject({
    id: 777000123,
    username: "hambazi_preview",
  });
  await page.getByRole("button", { name: "Continue preview" }).click();
  await expect(page.getByRole("heading", { name: "Games", exact: true })).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Display name" })).toHaveValue("Test player");
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("direct Coup preview opens the game with a synthetic session and no lobby steps", async ({
  page,
  request,
}) => {
  const submissions: unknown[] = [];
  const observePacket = (data: string) => {
    for (const packet of data.split("\u001e")) {
      const eventPacket = /^42(?:\/v1,)?\d*(\[.*\])$/.exec(packet);
      if (!eventPacket) continue;
      try {
        const [event, payload] = JSON.parse(eventPacket[1]!);
        if (event === "game:command") submissions.push(payload.command?.type);
      } catch {
        // Only observe synthetic command types; never export transport payloads.
      }
    }
  };
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      if (typeof payload === "string") observePacket(payload);
    }),
  );
  page.on("request", (input) => {
    if (input.method() === "POST" && new URL(input.url()).pathname === "/v1/socket.io/")
      observePacket(input.postData() ?? "");
  });
  await page.goto("/#/preview/coup");
  await expect(page.getByRole("heading", { name: "At the table" })).toBeVisible();
  await expect(page.getByRole("region", { name: "کارت‌های شما" })).toContainText("سفیر");
  const income = page.getByRole("button", { name: /^درآمد/ });
  await expect(income).toBeVisible();
  await expect(income).toBeEnabled();
  await expect(page.getByRole("button", { name: "Continue preview" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find players" })).toHaveCount(0);
  await income.click();
  await expect.poll(() => submissions).toEqual(["DECLARE_INCOME"]);
  await expect(income).toBeVisible();
  await expect(income).toBeEnabled();
  expect((await request.get("http://127.0.0.1:4174/__test/state")).status()).toBe(404);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

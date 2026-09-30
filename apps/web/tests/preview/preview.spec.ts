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

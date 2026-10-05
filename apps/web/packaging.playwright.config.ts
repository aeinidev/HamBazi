import { defineConfig } from "@playwright/test";

const baseURL = process.env.TEST_WEB_IMAGE_ORIGIN;
if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL))
  throw new Error("PACKAGING_BROWSER_ORIGIN_INVALID");

export default defineConfig({
  testDir: "./tests/packaging",
  workers: 1,
  use: { baseURL, browserName: "chromium", trace: "off", screenshot: "off", video: "off" },
  reporter: "list",
});

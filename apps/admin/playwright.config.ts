import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4193", browserName: "chromium", trace: "off" },
  webServer: {
    command: "pnpm preview --port 4193 --strictPort",
    url: "http://127.0.0.1:4193",
    reuseExistingServer: false,
  },
  reporter: "list",
});

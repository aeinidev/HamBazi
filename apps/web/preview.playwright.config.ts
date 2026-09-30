import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/preview",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4173", browserName: "chromium", trace: "off" },
  webServer: {
    command: "pnpm dev:preview",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: "list",
});

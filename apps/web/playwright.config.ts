import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4173", browserName: "chromium", trace: "off" },
  webServer: [
    {
      command: "node tests/browser/server.mjs",
      url: "http://127.0.0.1:4174/health",
      reuseExistingServer: false,
    },
    {
      env: { VITE_API_ORIGIN: "http://127.0.0.1:4174" },
      command: "pnpm dev --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
    },
  ],
  reporter: "list",
});

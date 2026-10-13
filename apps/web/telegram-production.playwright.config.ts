import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "**/browser/platform.spec.ts",
    "**/browser/telegram-privacy.spec.ts",
    "**/security/browser-policy.spec.ts",
  ],
  metadata: { telegramAuthMode: "automatic" },
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4173", browserName: "chromium", trace: "off" },
  webServer: [
    {
      command: "node tests/browser/server.mjs",
      url: "http://127.0.0.1:4174/health",
      reuseExistingServer: false,
    },
    {
      // Explicit synthetic destination only for this disposable built-app check.
      env: {
        VITE_API_ORIGIN: "http://127.0.0.1:4174",
        HAMBAZI_WEB_ORIGIN: "http://127.0.0.1:4173",
        HAMBAZI_WEB_POLICY_PROFILE: "loopback-test",
        HAMBAZI_WEB_FRAME_ANCESTORS: '["https://web.telegram.org","http://127.0.0.1:4175"]',
      },
      command: "pnpm build && pnpm preview --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
  reporter: "list",
});

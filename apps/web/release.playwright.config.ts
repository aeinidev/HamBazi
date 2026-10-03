import { defineConfig } from "@playwright/test";
import process from "node:process";

// Playwright otherwise attaches an accessibility snapshot to failed tests, even
// when trace/screenshots are off. These pages contain the recipient's private cards.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

// Provision PostgreSQL/Redis only through the existing disposable integration harness.
export default defineConfig({
  testDir: "./tests/release",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    actionTimeout: 10000,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  webServer: [
    {
      command: "node ../api/tests/fixtures/release-server.mjs",
      url: "http://127.0.0.1:4176/health",
      reuseExistingServer: false,
      timeout: 30000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
    },
    {
      env: {
        NODE_ENV: "production",
        VITE_API_ORIGIN: "http://127.0.0.1:4174",
        HAMBAZI_WEB_ORIGIN: "http://127.0.0.1:4173",
        HAMBAZI_WEB_POLICY_PROFILE: "loopback-test",
        HAMBAZI_WEB_FRAME_ANCESTORS: '["https://web.telegram.org"]',
      },
      command: "pnpm build && pnpm preview --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
  reporter: "list",
});

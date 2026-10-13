import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/kahroba",
  outputDir: "./test-results/kahroba",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4183",
    viewport: { width: 390, height: 844 },
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium", hasTouch: true } },
    { name: "webkit", use: { browserName: "webkit", hasTouch: true } },
  ],
  webServer: {
    command: "pnpm dev:kahroba",
    url: "http://127.0.0.1:4183",
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: "list",
});

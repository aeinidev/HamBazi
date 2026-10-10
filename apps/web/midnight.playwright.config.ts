import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/midnight",
  fullyParallel: false,
  workers: 1,
  use: { trace: "off", viewport: { width: 390, height: 844 } },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: [
    { command: "node tests/browser/server.mjs", url: "http://127.0.0.1:4174/health" },
    { command: "pnpm preview --port 4175 --strictPort", url: "http://127.0.0.1:4175" },
  ],
  reporter: "list",
});

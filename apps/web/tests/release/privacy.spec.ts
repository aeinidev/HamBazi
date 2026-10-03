import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, symlink, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

test("failed game-page checks keep private canaries out of diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-browser-diagnostics-"));
  const canary = randomUUID();
  const web = fileURLToPath(new URL("../../", import.meta.url));
  const support = fileURLToPath(new URL("support.ts", import.meta.url));
  try {
    await symlink(join(web, "node_modules"), join(directory, "node_modules"), "dir");
    await writeFile(
      join(directory, "playwright.config.mjs"),
      `export default { testDir: '.', outputDir: './results', workers: 1, expect: { timeout: 100 }, use: { actionTimeout: 100, trace: 'off', screenshot: 'off', video: 'off' }, reporter: 'list' };`,
    );
    await writeFile(
      join(directory, "canary.spec.ts"),
      `
import { test } from '@playwright/test';
import { visible, clickGameIntent } from ${JSON.stringify(support)};
test('scalar failure', async ({ page }) => {
  await page.setContent('<div>' + process.env.HAMBAZI_RELEASE_ERROR_CANARY + '</div>');
  await visible(page.locator('#missing'));
});
test('private button failure', async ({ page }) => {
  await page.setContent('<button style="visibility:hidden">' + process.env.HAMBAZI_RELEASE_ERROR_CANARY + '</button>');
  await clickGameIntent(page.locator('button'));
});
`,
    );
    let code = 0,
      diagnostics = "";
    try {
      await promisify(execFile)(
        "pnpm",
        ["test:browser", "--config", join(directory, "playwright.config.mjs")],
        {
          cwd: web,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: "test",
            PLAYWRIGHT_NO_COPY_PROMPT: "1",
            HAMBAZI_RELEASE_ERROR_CANARY: canary,
          },
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        },
      );
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      code = failure.code ?? -1;
      diagnostics = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
    }
    expect(code).toBe(1);
    const results = join(directory, "results");
    const contexts = (await readdir(results, { recursive: true })).filter((name) =>
      name.endsWith("error-context.md"),
    );
    expect(contexts.length).toBe(2);
    for (const name of contexts) diagnostics += await readFile(join(results, name), "utf8");
    expect(diagnostics.includes(canary)).toBe(false);
    expect(diagnostics.includes("```yaml")).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

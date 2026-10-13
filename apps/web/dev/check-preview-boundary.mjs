import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { telegramSdkIntegrity, telegramSdkUrl } from "../src/platform/telegram-sdk.ts";
import { parseBrowserPolicyArtifact } from "../security/browser-policy.ts";

const output = fileURLToPath(new URL("../dist/client/", import.meta.url));
const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
try {
  parseBrowserPolicyArtifact(
    await readFile(new URL("../dist/client/security-headers.json", import.meta.url), "utf8"),
    telegramSdkIntegrity,
  );
} catch {
  throw new Error("INVALID_WEB_BROWSER_POLICY");
}
if (/<script\b[^>]*src=["']https:\/\/telegram\.org\//i.test(html))
  throw new Error("Production HTML loads Telegram before the privacy guard");

const markers = [
  "hambazi-local-preview",
  "hambazi_preview",
  "777000123",
  "preview=synthetic",
  "Continue preview",
  "Local preview · synthetic Telegram identity and server data",
  "hambazi-coup-preview-match",
  "/preview/coup",
  "hambazi-kahroba-local-preview",
  "kahroba-synthetic-only",
  "kahroba-local-",
  "/__preview/case",
];
let officialBridge = false;
let launchCacheGuard = false;
let integrityPin = false;
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if (entry.isFile()) {
      const content = await readFile(path, "utf8");
      if (entry.name.endsWith(".js")) {
        officialBridge ||= content.includes(telegramSdkUrl);
        launchCacheGuard ||= content.includes("__telegram__initParams");
        integrityPin ||= content.includes(telegramSdkIntegrity);
      }
      if (markers.some((marker) => content.includes(marker)))
        throw new Error(`Preview data found in production output: ${entry.name}`);
    }
  }
}
await check(output);
if (!officialBridge || !launchCacheGuard || !integrityPin)
  throw new Error("Production build is missing the guarded, integrity-pinned Telegram bridge");

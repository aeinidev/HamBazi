import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const output = fileURLToPath(new URL("../dist/client/", import.meta.url));
const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
if (!html.includes('src="https://telegram.org/js/telegram-web-app.js"'))
  throw new Error("Production build is missing the official Telegram bridge");

const markers = [
  "hambazi-local-preview",
  "hambazi_preview",
  "777000123",
  "preview=synthetic",
  "Continue preview",
  "Local preview · synthetic Telegram identity and server data",
  "hambazi-coup-preview-match",
  "/preview/coup",
];
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if (entry.isFile()) {
      const content = await readFile(path, "utf8");
      if (markers.some((marker) => content.includes(marker)))
        throw new Error(`Preview data found in production output: ${entry.name}`);
    }
  }
}
await check(output);

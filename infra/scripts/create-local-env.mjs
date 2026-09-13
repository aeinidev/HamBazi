import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The template is documentation, never a source of reusable credentials.
export async function createLocalEnvironment(directory) {
  const template = await readFile(new URL("../../.env.example", import.meta.url), "utf8");
  const replacements = new Map();
  for (const token of template.match(/REPLACE_[A-Z_]+/g) ?? []) {
    if (!replacements.has(token)) replacements.set(token, randomBytes(32).toString("hex"));
  }
  const content = template.replace(/REPLACE_[A-Z_]+/g, (token) => replacements.get(token));
  // Exclusive creation preserves any existing file, including a symlink target.
  await writeFile(resolve(directory, ".env"), content, { flag: "wx", mode: 0o600 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await createLocalEnvironment(process.cwd());
    console.info("Created private .env for local development. Do not commit or print it.");
  } catch {
    console.error(
      "Could not create .env; check permissions and whether it already exists. No existing file was overwritten.",
    );
    process.exitCode = 1;
  }
}

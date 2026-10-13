import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
if (process.env.NODE_ENV === "production")
  throw new Error("Local Kahroba preview cannot run in production");
const root = fileURLToPath(new URL("../", import.meta.url)),
  children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
function start(cmd, args) {
  const child = spawn(cmd, args, { cwd: root, env: process.env, stdio: "inherit" });
  children.add(child);
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    children.delete(child);
    if (!stopping) stop(code ?? 1);
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
start(process.execPath, ["tests/kahroba/server.mjs"]);
let ready = false;
for (let attempt = 0; attempt < 50; attempt++) {
  try {
    if ((await fetch("http://127.0.0.1:4184/health")).ok) {
      ready = true;
      break;
    }
  } catch {
    /* Binding only our disposable fixture. */
  }
  await new Promise((r) => setTimeout(r, 100));
}
if (!ready) stop(1);
else
  start(process.execPath, [
    join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin/vite.js"),
    "--config",
    "kahroba.preview.config.ts",
  ]);

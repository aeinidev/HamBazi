// Starts only the disposable browser-test transport and the local preview UI.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.env.NODE_ENV === "production")
  throw new Error("Local preview cannot run in production mode");

const root = fileURLToPath(new URL("../", import.meta.url));
const fixturePath = fileURLToPath(new URL("../tests/browser/server.mjs", import.meta.url));
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
function start(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
  children.add(child);
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    children.delete(child);
    if (!stopping) stop(code ?? 1);
  });
  return child;
}

start(process.execPath, [fixturePath], { ...process.env, HAMBAZI_PREVIEW_MODE: "1" });
let ready = false;
for (let attempt = 0; attempt < 50 && !stopping; attempt++) {
  try {
    const response = await fetch("http://127.0.0.1:4174/health", {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    // The fixture may still be binding its loopback port.
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!ready) stop(1);
if (!stopping)
  start("pnpm", ["exec", "vite", "--config", "preview.config.ts"], {
    ...process.env,
    VITE_API_ORIGIN: "http://127.0.0.1:4174",
  });

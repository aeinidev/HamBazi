import { createServer } from "node:http";
import { lstat, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseBrowserPolicyArtifact } from "../security/browser-policy.ts";
import { telegramSdkIntegrity } from "../src/platform/telegram-sdk.ts";

const mime = Object.freeze({
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  woff2: "font/woff2",
  ttf: "font/ttf",
});
const invalid = () => {
  throw new Error("WEB_STATIC_CONFIGURATION_INVALID");
};
const port = (value) => {
  if (!/^\d{1,5}$/.test(value ?? "") || Number(value) < 1024 || Number(value) > 65535) invalid();
  return Number(value);
};

/** Serve only an immutable, prevalidated public asset inventory. No request logging. */
export async function startStaticWeb(
  environment,
  directory = fileURLToPath(new URL("../dist/client", import.meta.url)),
) {
  const publicPort = port(environment.WEB_PORT);
  const healthPort = port(environment.WEB_HEALTH_PORT);
  if (!["0.0.0.0", "127.0.0.1"].includes(environment.WEB_BIND_ADDRESS)) invalid();
  if (publicPort === healthPort || environment.NODE_ENV !== "production") invalid();
  const policy = parseBrowserPolicyArtifact(
    await readFile(resolve(directory, "security-headers.json"), "utf8"),
    telegramSdkIntegrity,
  );
  if (policy.profile !== "production") invalid();
  const files = new Map();
  let bytes = 0;
  async function collect(path = "") {
    const info = await lstat(resolve(directory, path));
    if (info.isSymbolicLink()) invalid();
    if (info.isDirectory()) {
      for (const name of await readdir(resolve(directory, path))) {
        if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,150}$/.test(name)) invalid();
        await collect(path ? `${path}/${name}` : name);
      }
    } else {
      const type = mime[path.split(".").at(-1)];
      if (!info.isFile() || !type || info.size > 16 * 1024 * 1024 || files.size >= 1000) invalid();
      const data = await readFile(resolve(directory, path));
      bytes += data.length;
      if (bytes > 64 * 1024 * 1024) invalid();
      files.set(`/${path}`, { data, type });
    }
  }
  await collect();
  if (!files.has("/index.html")) invalid();
  let stopping = false;
  const send = (response, status, body, type = "text/plain; charset=utf-8", head = false) => {
    response.writeHead(status, {
      ...policy.headers,
      "Content-Type": type,
      "Content-Length": body.length,
    });
    response.end(head ? undefined : body);
  };
  const server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 },
    (request, response) => {
      if (stopping) return send(response, 503, Buffer.from("Unavailable"));
      if (!["GET", "HEAD"].includes(request.method))
        return send(response, 405, Buffer.from("Method not allowed"));
      let path;
      try {
        if (!request.url?.startsWith("/") || request.url.length > 2048) throw new Error();
        path = decodeURIComponent(request.url.split("?")[0]);
        if (
          path.includes("\\") ||
          path.includes("\0") ||
          path.split("/").some((p) => p.startsWith("."))
        )
          throw new Error();
      } catch {
        return send(response, 400, Buffer.from("Bad request"));
      }
      const file = files.get(path === "/" ? "/index.html" : path);
      if (!file) return send(response, 404, Buffer.from("Not found"));
      send(response, 200, file.data, file.type, request.method === "HEAD");
    },
  );
  const health = createServer({ maxHeaderSize: 4096 }, (request, response) => {
    const known =
      request.method === "GET" && ["/v1/health/live", "/v1/health/ready"].includes(request.url);
    const status =
      known && !stopping ? (request.url.endsWith("live") ? "LIVE" : "READY") : "NOT_READY";
    const body = Buffer.from(JSON.stringify({ schemaVersion: 1, status }));
    send(response, known ? (stopping ? 503 : 200) : 404, body, "application/json");
  });
  const listen = (listener, selectedPort, host) =>
    new Promise((accept, reject) => {
      listener.once("error", reject);
      listener.listen(selectedPort, host, accept);
    });
  const close = (listener) => new Promise((accept) => listener.close(accept));
  try {
    await listen(health, healthPort, "127.0.0.1");
    await listen(server, publicPort, environment.WEB_BIND_ADDRESS);
  } catch {
    await Promise.all([close(server), close(health)]);
    invalid();
  }
  let closing;
  return {
    close() {
      stopping = true;
      return (closing ??= Promise.all([close(server), close(health)]).then(() => undefined));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const web = await startStaticWeb(process.env);
    const stop = () => {
      void web.close();
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  } catch {
    console.error("WEB_STATIC_STARTUP_FAILED");
    process.exitCode = 1;
  }
}

import { createServer, request } from "node:http";

const product = /^\/v1\/(auth|me|games|rooms|room-invites|leaderboards)(?:\/|$)/;
const blocked = new Set(["connection", "transfer-encoding", "host", "forwarded"]);
function headers(input, publicRequest) {
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (blocked.has(key) || key.startsWith("x-forwarded-") || key.startsWith("cf-")) continue;
    result[key] = value;
  }
  result["x-forwarded-proto"] = publicRequest ? "https" : "http";
  // A temporary generic tunnel does not establish a trusted client-IP policy.
  // Shared loopback admission is conservative; clients cannot inject an IP.
  return result;
}

/** Laptop-only ingress. No access logging and no private/health/admin forwarding. */
export async function startLaptopProxy({ port, apiPort, webPort, origin }) {
  let ready = false;
  const respond = (res, status) => {
    res.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Strict-Transport-Security": "max-age=31536000",
    });
    res.end(status === 503 ? "Server is starting" : "Not found");
  };
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 15000 }, (req, res) => {
    if (!ready) return respond(res, 503);
    const publicOrigin = origin();
    const publicRequest = Boolean(publicOrigin && req.headers.host === new URL(publicOrigin).host);
    if (!publicRequest && ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host))
      return respond(res, 404);
    let path;
    try {
      if (!req.url?.startsWith("/") || req.url.length > 8192) throw new Error();
      path = decodeURIComponent(req.url.split("?")[0]);
      if (
        path.includes("\\") ||
        path.includes("\0") ||
        path.split("/").some((p) => p.startsWith("."))
      )
        throw new Error();
    } catch {
      return respond(res, 404);
    }
    const api = product.test(path);
    if (!api && (path.startsWith("/v1") || path.startsWith("/socket.io"))) return respond(res, 404);
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: api ? apiPort : webPort,
        path: req.url,
        method: req.method,
        headers: headers(req.headers, publicRequest),
        timeout: 15000,
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent) respond(res, 503);
      else res.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
  server.maxConnections = 128;
  server.on("upgrade", (_req, socket) => {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", accept);
  });
  return {
    ready() {
      ready = true;
    },
    close() {
      ready = false;
      return new Promise((accept) => server.close(accept));
    },
  };
}

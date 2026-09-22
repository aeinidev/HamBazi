import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { request } from "node:https";
import type { AddressInfo } from "node:net";
import { SecretValue, parseBotServiceConfig } from "@hambazi/config";
import { createBotServiceAuthenticator } from "../../src/auth/index.js";
import { createBotInternalHttpApplication } from "../../src/composition/bot-internal-http.js";
export const bearer = `Bearer current.${Buffer.alloc(32, 17).toString("base64url")}`;
export const serviceEnvironment = {
  TELEGRAM_BOT_TOKEN: `123:${"a".repeat(32)}`,
  AUTH_SESSION_SECONDS: "900",
  AUTH_TELEGRAM_MAX_AGE_SECONDS: "300",
  AUTH_TELEGRAM_FUTURE_SKEW_SECONDS: "30",
  AUTH_IP_LIMIT: "30",
  AUTH_IDENTITY_LIMIT: "6",
  AUTH_ACTIVE_KEY_ID: "session",
  AUTH_ISSUER: "test",
  AUTH_AUDIENCE: "mini-app",
  AUTH_SIGNING_KEYS: JSON.stringify([
    { id: "session", secret: Buffer.alloc(32, 19).toString("base64url") },
  ]),
  API_TRUSTED_PROXIES: "",
  API_BIND_ADDRESS: "127.0.0.1",
  API_DB_POOL_MAX: "5",
  PROFILE_READ_LIMIT: "60",
  CATALOG_READ_LIMIT: "60",
  PROFILE_WRITE_LIMIT: "10",
  BOT_SERVICE_ACTIVE_KEY_ID: "current",
  BOT_SERVICE_KEYS: JSON.stringify([
    { id: "current", secret: Buffer.alloc(32, 17).toString("base64url") },
  ]),
  BOT_SERVICE_ALLOWED_PEERS: "127.0.0.1",
  TELEGRAM_WEBHOOK_SECRET: "w".repeat(40),
};
export async function testCertificate() {
  return withTestCertificate(async (tls) => tls);
}
export async function withTestCertificate<T>(
  run: (
    tls: { key: SecretValue; cert: string },
    files: { keyFile: string; certFile: string },
  ) => Promise<T>,
) {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-test-tls-"));
  try {
    await promisify(execFile)(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-noenc",
        "-keyout",
        join(directory, "key.pem"),
        "-out",
        join(directory, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:localhost",
      ],
      { timeout: 10000 },
    );
    const tls = {
      key: new SecretValue(await readFile(join(directory, "key.pem"), "utf8")),
      cert: await readFile(join(directory, "cert.pem"), "utf8"),
    };
    return await run(tls, {
      keyFile: join(directory, "key.pem"),
      certFile: join(directory, "cert.pem"),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export async function internalHarness(
  options: Omit<Parameters<typeof createBotInternalHttpApplication>[0], "authenticator"> & {
    allowedPeers?: string;
  },
) {
  const http = await createBotInternalHttpApplication({
    ...options,
    authenticator: createBotServiceAuthenticator(
      parseBotServiceConfig({
        ...serviceEnvironment,
        BOT_SERVICE_ALLOWED_PEERS: options.allowedPeers ?? "127.0.0.1",
      }),
    ),
  });
  await http.app.listen(0, "127.0.0.1");
  const port = (http.server.server.address() as AddressInfo).port;
  function post(
    path: string,
    body: unknown,
    headers: Record<string, string | string[]> = {},
    trust = true,
  ) {
    return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>(
      (resolve, reject) => {
        const req = request(
          {
            host: "127.0.0.1",
            port,
            path,
            method: "POST",
            agent: false,
            ...(trust ? { ca: options.tls.cert } : {}),
            headers: { "content-type": "application/json", authorization: bearer, ...headers },
          },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.once("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
          },
        );
        req.once("error", reject);
        req.setTimeout(2000, () => req.destroy(new Error("test request timed out")));
        req.end(typeof body === "string" ? body : JSON.stringify(body));
      },
    );
  }
  return { ...http, port, post };
}

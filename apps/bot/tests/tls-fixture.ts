import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { request } from "node:https";
import { SecretValue } from "@hambazi/config";
export async function certificate() {
  return withCertificate(async (tls) => tls);
}
export async function withCertificate<T>(
  run: (
    tls: { key: SecretValue; cert: string },
    files: { keyFile: string; certFile: string },
  ) => Promise<T>,
) {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-bot-tls-"));
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
        join(directory, "key"),
        "-out",
        join(directory, "cert"),
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
      key: new SecretValue(await readFile(join(directory, "key"), "utf8")),
      cert: await readFile(join(directory, "cert"), "utf8"),
    };
    return await run(tls, { keyFile: join(directory, "key"), certFile: join(directory, "cert") });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export function post(
  port: number,
  ca: string,
  path: string,
  body: unknown,
  headers: Record<string, string | string[]> = {},
) {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>(
    (resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          ca,
          method: "POST",
          path,
          agent: false,
          headers: { "content-type": "application/json", ...headers },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
        },
      );
      req.on("error", reject);
      req.setTimeout(2000, () => req.destroy(new Error("Test request timeout")));
      req.end(typeof body === "string" ? body : JSON.stringify(body));
    },
  );
}

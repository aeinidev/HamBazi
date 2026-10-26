import process from "node:process";
import { request } from "node:https";
import { URL } from "node:url";
import { createDatabase } from "@hambazi/database";
import { createClient } from "redis";

let database, redis;
try {
  if (process.env.ADMIN_ENABLED !== "true") throw new Error();
  database = createDatabase({
    databaseUrl: { reveal: () => process.env.ADMIN_DATABASE_URL },
    poolMax: 1,
    connectionTimeoutMs: 1500,
    idleTimeoutMs: 1000,
    transactionMaxWaitMs: 1500,
    transactionTimeoutMs: 2000,
  });
  redis = createClient({
    url: process.env.ADMIN_REDIS_URL,
    disableOfflineQueue: true,
    socket: { connectTimeout: 1500, reconnectStrategy: false },
  });
  redis.on("error", () => {});
  await Promise.all([database.connect(), redis.connect()]);
  if (
    !(await database.probe()) ||
    (await redis.withAbortSignal(AbortSignal.timeout(1500)).ping()) !== "PONG"
  )
    throw new Error();
  await new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: process.env.ADMIN_BIND_ADDRESS,
        port: Number(process.env.ADMIN_PORT),
        servername: "admin-api.internal",
        path: "/v1/admin/me/access",
        method: "GET",
        headers: { Host: new URL(process.env.ADMIN_ORIGIN).host },
      },
      (res) => {
        res.resume();
        res.once("end", () =>
          res.statusCode === 401 && res.headers["cache-control"] === "no-store"
            ? resolve()
            : reject(new Error()),
        );
      },
    );
    req.once("error", reject);
    req.setTimeout(2000, () => req.destroy(new Error()));
    req.end();
  });
} catch {
  process.exitCode = 1;
} finally {
  redis?.destroy();
  await database?.disconnect().catch(() => {
    process.exitCode = 1;
  });
}

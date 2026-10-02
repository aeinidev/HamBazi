import { readFile, stat } from "node:fs/promises";
import { parseBotRuntimeConfig, SecretValue } from "@hambazi/config";
import { createBackend } from "../backend.js";
import { createTelegramSender } from "../telegram.js";
import { createDeliveryHandler } from "../delivery.js";
import { createBotHttp } from "./http.js";
import type { BotLogger } from "./logger.js";
import { parseOperationsConfig } from "@hambazi/config";
import { createServiceHealth, startHealthServer, withDeadline } from "@hambazi/observability";
async function pem(path: string) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > 65536) throw new Error();
  const data = await readFile(path);
  if (data.length > 65536) throw new Error();
  return data.toString("utf8");
}
export async function startBot(
  env: Readonly<Record<string, string | undefined>>,
  logger: BotLogger,
) {
  let backend: ReturnType<typeof createBackend> | undefined;
  let http: ReturnType<typeof createBotHttp> | undefined;
  const operations = parseOperationsConfig(env, "bot");
  const health = createServiceHealth(
    [{ required: true, probe: (signal) => backend!.probe(signal) }],
    operations.probeTimeoutMs,
  );
  let healthServer: Awaited<ReturnType<typeof startHealthServer>> | undefined;
  try {
    const config = parseBotRuntimeConfig(env);
    if (operations.port) healthServer = await startHealthServer(health, operations.port);
    const [key, cert, ca] = await Promise.all([
      pem(config.keyFile),
      pem(config.certFile),
      config.apiCaFile ? pem(config.apiCaFile) : undefined,
    ]);
    backend = createBackend({
      origin: config.apiOrigin,
      bearer: config.serviceBearer,
      timeoutMs: config.backendTimeoutMs,
      ...(ca ? { ca } : {}),
    });
    // Read-only admission probe; no webhook registration or Telegram API call at startup.
    await backend.backend.admit(AbortSignal.timeout(config.backendTimeoutMs));
    const sender = createTelegramSender({
      token: config.botToken,
      miniAppUrl: config.miniAppUrl,
      timeoutMs: config.sendTimeoutMs,
    });
    http = createBotHttp({
      tls: { key: new SecretValue(key), cert },
      secret: config.webhookSecret,
      backend: backend.backend,
      handle: createDeliveryHandler({
        backend: backend.backend,
        sender,
        botId: config.botId,
        username: config.botUsername,
      }),
      timeoutMs: config.requestTimeoutMs,
      maxInFlight: config.maxInFlight,
      logger,
    });
    await http.server.listen({ host: config.bindAddress, port: config.port });
    health.started();
    logger.lifecycle("bot.started");
    let closing: Promise<void> | undefined;
    return {
      health,
      drainTimeoutMs: operations.drainTimeoutMs,
      close() {
        health.stopAdmission();
        http!.stopAdmission();
        return (closing ??= withDeadline(
          (async () => {
            await http!.close();
            backend!.close();
            health.stopped();
            await healthServer?.close();
            logger.lifecycle("bot.stopped");
          })(),
          operations.drainTimeoutMs,
        ));
      },
    };
  } catch {
    await http?.close().catch(() => {});
    backend?.close();
    health.stopped();
    await healthServer?.close().catch(() => {});
    throw new Error("Bot startup failed");
  }
}

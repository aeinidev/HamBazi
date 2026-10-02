import {
  createCorrelation,
  currentCorrelation,
  safeTraceparent,
  withCorrelation,
} from "@hambazi/observability";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { TLSSocket } from "node:tls";
import { NestFactory } from "@nestjs/core";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { HttpException } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createErrorEnvelope } from "@hambazi/contracts";
import {
  createBotInternalHttpModule,
  sendRateDecision,
  type BotServiceAuthenticator,
  type BotServiceContext,
  type BotOnboarding,
  type AuthRateLimiter,
} from "../auth/index.js";
import type { SafeLogger } from "./safe-logger.js";

/** Dedicated TLS listener; never attach these routes to the public API or a public proxy. */
export async function createBotInternalHttpApplication(options: {
  authenticator: BotServiceAuthenticator;
  onboarding: BotOnboarding;
  limiter: AuthRateLimiter;
  tls: { key: { reveal(): string }; cert: string };
  logger: SafeLogger;
}) {
  const adapter = new FastifyAdapter({
    logger: false,
    trustProxy: false,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 4096,
    requestTimeout: 10000,
    connectionTimeout: 15000,
    keepAliveTimeout: 5000,
    maxRequestsPerSocket: 100,
    https: {
      key: options.tls.key.reveal(),
      cert: options.tls.cert,
      minVersion: "TLSv1.2",
      maxHeaderSize: 8192,
    },
  });
  const server = adapter.getInstance();
  server.server.headersTimeout = 10000;
  const contexts = new WeakMap<FastifyRequest, BotServiceContext>();
  server.addHook("onRequest", (request, _reply, done) => {
    withCorrelation(createCorrelation({ requestId: request.id }), done);
  });
  server.addHook("onRequest", async (request, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
      .header("Strict-Transport-Security", "max-age=31536000")
      .header("X-Request-Id", request.id);
    if (
      !(request.raw.socket instanceof TLSSocket) ||
      !request.raw.socket.encrypted ||
      Object.keys(request.headers).some(
        (key) => key === "origin" || key === "forwarded" || key.startsWith("x-forwarded-"),
      )
    )
      return reply.code(403).send(createErrorEnvelope("FORBIDDEN"));
    const context = options.authenticator.authenticate({
      rawHeaders: request.raw.rawHeaders,
      remoteAddress: request.raw.socket.remoteAddress,
      requiredScope: "bot:onboarding",
    });
    if (!context) return reply.code(401).send(createErrorEnvelope("UNAUTHENTICATED"));
    contexts.set(request, context);
    if (sendRateDecision(reply, await options.limiter.consumeIp(`bot:${context.botId}`)))
      return reply;
    if (request.url.includes("?"))
      return reply.code(400).send(createErrorEnvelope("INVALID_INPUT"));
  });
  server.addHook("onRequest", (request, _reply, done) => {
    // A private, service-authenticated peer can continue a trace; public listeners ignore it.
    const parent = contexts.has(request) ? safeTraceparent(request.headers.traceparent) : undefined;
    withCorrelation(
      createCorrelation({
        requestId: request.id,
        traceparent: parent ?? currentCorrelation()?.traceparent,
      }),
      done,
    );
  });
  server.addHook("onResponse", async (request, reply) =>
    options.logger.completed(request.id, reply.elapsedTime, reply.statusCode),
  );
  const app = await NestFactory.create<NestFastifyApplication>(
    createBotInternalHttpModule({
      onboarding: options.onboarding,
      limiter: options.limiter,
      context: (r) => contexts.get(r),
    }),
    adapter,
    { logger: false, abortOnError: false },
  );
  const filter: ExceptionFilter = {
    catch(error: unknown, host: ArgumentsHost) {
      const candidate =
        error instanceof HttpException
          ? error.getStatus()
          : typeof error === "object" && error !== null && "statusCode" in error
            ? error.statusCode
            : undefined;
      const status = [400, 404, 413, 415].includes(Number(candidate)) ? Number(candidate) : 500;
      host
        .switchToHttp()
        .getResponse<FastifyReply>()
        .code(status)
        .send(
          createErrorEnvelope(
            status === 500 ? "INTERNAL_ERROR" : status === 404 ? "NOT_FOUND" : "INVALID_INPUT",
          ),
        );
    },
  };
  app.useGlobalFilters(filter);
  try {
    await app.init();
    await server.ready();
    return { app, server };
  } catch {
    await app.close().catch(() => {});
    throw new Error("Bot internal transport initialization failed");
  }
}

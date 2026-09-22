import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { HttpException, Module } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyReply } from "fastify";
import { createErrorEnvelope } from "@hambazi/contracts";
import { authPaths, createAuthHttpModule, sendRateDecision } from "../auth/index.js";
import type { SafeLogger } from "./safe-logger.js";
import { createProfileHttpModule, type ProfileHttpDependencies } from "../users/index.js";

export async function createHttpApplication(options: {
  auth: Parameters<typeof createAuthHttpModule>[0];
  profile?: ProfileHttpDependencies;
  allowedOrigins: readonly string[];
  trustedProxies: readonly string[];
  production: boolean;
  logger: SafeLogger;
}) {
  const adapter = new FastifyAdapter({
    logger: false,
    bodyLimit: 32768,
    requestTimeout: 10000,
    connectionTimeout: 15000,
    keepAliveTimeout: 5000,
    maxRequestsPerSocket: 100,
    trustProxy: options.trustedProxies.length ? [...options.trustedProxies] : false,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    http: { maxHeaderSize: 16384 },
  });
  const server = adapter.getInstance();
  server.server.headersTimeout = 10000;
  server.addHook("onRequest", async (request, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("Pragma", "no-cache")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      )
      .header("Referrer-Policy", "no-referrer")
      .header("X-Request-Id", request.id);
    if (options.production) {
      reply.header("Strict-Transport-Security", "max-age=31536000");
      if (request.protocol !== "https")
        return reply.code(403).send(createErrorEnvelope("FORBIDDEN"));
    }
    const origin = request.headers.origin;
    reply.header("Vary", "Origin");
    if (origin !== undefined) {
      if (!options.allowedOrigins.includes(origin))
        return reply.code(403).send(createErrorEnvelope("FORBIDDEN"));
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Expose-Headers", "X-Request-Id, Retry-After");
    }
    if (request.method === "OPTIONS") {
      if (
        !origin ||
        ![
          "GET",
          "POST",
          ...(options.profile && request.url === "/v1/me" ? ["PATCH"] : []),
        ].includes(String(request.headers["access-control-request-method"]))
      )
        return reply.code(403).send(createErrorEnvelope("FORBIDDEN"));
      const requested = String(request.headers["access-control-request-headers"] ?? "")
        .toLowerCase()
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (requested.some((v) => !["authorization", "content-type"].includes(v)))
        return reply.code(403).send(createErrorEnvelope("FORBIDDEN"));
      return reply
        .header("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers")
        .header(
          "Access-Control-Allow-Methods",
          options.profile && request.url === "/v1/me" ? "GET, POST, PATCH" : "GET, POST",
        )
        .header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        .code(204)
        .send();
    }
    if (
      (request.routeOptions.url === authPaths.issue ||
        request.routeOptions.url === authPaths.createAccount) &&
      sendRateDecision(reply, await options.auth.limiter.consumeIp(request.ip))
    )
      return reply;
    if (request.url.includes("?"))
      return reply.code(400).send(createErrorEnvelope("INVALID_INPUT"));
  });
  server.addHook("onResponse", async (request, reply) => {
    options.logger.completed(request.id, reply.elapsedTime, reply.statusCode);
  });
  @Module({
    imports: [
      createAuthHttpModule(options.auth),
      ...(options.profile ? [createProfileHttpModule(options.profile)] : []),
    ],
  })
  class HttpModule {}
  const app = await NestFactory.create<NestFastifyApplication>(HttpModule, adapter, {
    logger: false,
    abortOnError: false,
  });
  const filter: ExceptionFilter = {
    catch(exception: unknown, host: ArgumentsHost) {
      const candidate =
        exception instanceof HttpException
          ? exception.getStatus()
          : typeof exception === "object" && exception !== null && "statusCode" in exception
            ? exception.statusCode
            : undefined;
      const status =
        candidate === 413
          ? 413
          : candidate === 415
            ? 415
            : candidate === 400
              ? 400
              : candidate === 404
                ? 404
                : 500;
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
  await app.init();
  await server.ready();
  return { app, server };
}

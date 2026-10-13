import { createPersonalGateway, type PersonalGatewayDependencies } from "../realtime/index.js";
import { createCorrelation, withCorrelation } from "@hambazi/observability";
import {
  createStatisticsHttpModule,
  type StatisticsHttpDependencies,
} from "../leaderboard/index.js";
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
import { createCatalogHttpModule, type CatalogHttpDependencies } from "../games/index.js";

import { createRoomsHttpModule, type RoomsHttpDependencies } from "../rooms/index.js";
import { createRealtimeGateway, type RealtimeDependencies } from "../realtime/index.js";
import { trackHttpWork } from "./http-drain.js";
import { installHttpAdmission, type HttpAdmission } from "./http-admission.js";
import { createKahrobaHttpModule } from "./kahroba-http.js";

export async function createHttpApplication(options: {
  auth: Parameters<typeof createAuthHttpModule>[0];
  profile?: ProfileHttpDependencies;
  statistics?: StatisticsHttpDependencies;
  catalog?: CatalogHttpDependencies;
  rooms?: RoomsHttpDependencies;
  personal?: PersonalGatewayDependencies;
  realtime?: RealtimeDependencies;
  kahroba?: {
    rooms: RoomsHttpDependencies;
    metadata: Parameters<typeof createKahrobaHttpModule>[0];
  };
  admission?: HttpAdmission;
  allowedOrigins: readonly string[];
  trustedProxies: readonly string[];
  production: boolean;
  logger: SafeLogger;
}) {
  if (options.production && !options.admission)
    throw new Error("Production HTTP admission configuration is required");
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
  if (options.admission) server.server.maxConnections = options.admission.policy.maxConnections;
  const settled = trackHttpWork(server);
  let draining = false;
  server.server.headersTimeout = 10000;
  server.addHook("onRequest", (request, _reply, done) => {
    withCorrelation(createCorrelation({ requestId: request.id }), done);
  });
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
    if (draining)
      return reply.header("Retry-After", "1").code(503).send(createErrorEnvelope("INTERNAL_ERROR"));
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
  });
  if (options.admission) installHttpAdmission(server, options.admission);
  server.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
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
    if (
      request.url.includes("?") &&
      !(
        options.statistics &&
        request.method === "GET" &&
        (request.routeOptions.url === "/v1/me/stats" ||
          request.routeOptions.url === "/v1/leaderboards/:game")
      )
    )
      return reply.code(400).send(createErrorEnvelope("INVALID_INPUT"));
  });
  server.addHook("onResponse", async (request, reply) => {
    options.logger.completed(
      request.id,
      reply.elapsedTime,
      reply.statusCode,
      Object.values(authPaths).some((path) => path === request.routeOptions.url) ? "auth" : "http",
    );
  });
  @Module({
    imports: [
      createAuthHttpModule(options.auth),
      ...(options.statistics ? [createStatisticsHttpModule(options.statistics)] : []),
      ...(options.rooms ? [createRoomsHttpModule(options.rooms)] : []),
      ...(options.kahroba
        ? [
            createRoomsHttpModule(options.kahroba.rooms, "v1/kahroba"),
            createKahrobaHttpModule(options.kahroba.metadata),
          ]
        : []),
      ...(options.profile ? [createProfileHttpModule(options.profile)] : []),
      ...(options.catalog ? [createCatalogHttpModule(options.catalog)] : []),
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
  const realtime = options.realtime
    ? createRealtimeGateway(server.server, {
        ...options.realtime,
        admission: {
          ...options.realtime.admission,
          trustedProxies: options.trustedProxies,
          production: options.production,
        },
        metrics: options.realtime.metrics ?? options.logger.metrics,
        telemetry: options.realtime.telemetry ?? options.logger.telemetry,
      })
    : undefined;
  const personal = options.personal
    ? createPersonalGateway(server.server, {
        ...options.personal,
        ...(options.kahroba ? { coexistsWithKahroba: true } : {}),
      })
    : undefined;
  if (options.personal && options.kahroba)
    server.server.on("upgrade", (request, socket) => {
      const path = (request.url ?? "").split("?")[0];
      if (
        ![
          "/v1/personal/socket.io",
          "/v1/personal/socket.io/",
          "/v1/kahroba/socket.io",
          "/v1/kahroba/socket.io/",
        ].includes(path ?? "")
      )
        socket.destroy();
    });
  return {
    personal,
    app,
    server,
    realtime,
    settled,
    stopAdmission() {
      draining = true;
      realtime?.stopAdmission();
      personal?.stopAdmission();
    },
  };
}

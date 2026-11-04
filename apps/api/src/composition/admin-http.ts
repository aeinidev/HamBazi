import "reflect-metadata";
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { isIP } from "node:net";
import {
  AdminFault,
  createAdminHttpModule,
  adminCookie,
  adminRequestCookie,
  type AdminService,
} from "../admin/index.js";

const body = (code: string) => ({
  ok: false,
  error: {
    code,
    message:
      code === "UNAUTHENTICATED" ? "Authentication failed" : "Request could not be completed",
    retryable: false,
  },
});
@Catch()
class AdminExceptionFilter implements ExceptionFilter {
  constructor(private readonly service: AdminService) {}
  async catch(error: unknown, host: ArgumentsHost) {
    const code =
      error instanceof AdminFault
        ? error.code
        : error instanceof ZodError
          ? "INVALID_INPUT"
          : error instanceof HttpException && error.getStatus() === 404
            ? "NOT_FOUND"
            : "ADMIN_UNAVAILABLE";
    const status =
      code === "UNAUTHENTICATED"
        ? 401
        : code === "FORBIDDEN"
          ? 403
          : code === "INVALID_INPUT"
            ? 400
            : code === "NOT_FOUND"
              ? 404
              : code === "RATE_LIMITED"
                ? 429
                : code === "ADMIN_CONFLICT"
                  ? 409
                  : 503;
    if (code === "FORBIDDEN") {
      const request = host.switchToHttp().getRequest<FastifyRequest>();
      try {
        await this.service.noteDenied(adminRequestCookie(request, adminCookie));
      } catch {
        /* Denial still has no effect when Audit or identity is unavailable. */
      }
    }
    host.switchToHttp().getResponse<FastifyReply>().code(status).send(body(code));
  }
}
export async function createAdminHttpApplication(
  deps: Parameters<typeof createAdminHttpModule>[0],
  transport: {
    key: Buffer;
    cert: Buffer;
    origin: string;
    peers: readonly string[];
    ingressMode?: "private" | "public-proxy";
    proxyPeers?: readonly string[];
    maxInFlight: number;
    admitIp(ip: string): Promise<boolean>;
    admitIdentity(username: string): Promise<boolean>;
  },
): Promise<NestFastifyApplication> {
  const proxies = transport.proxyPeers ?? [];
  if (
    (transport.ingressMode === "public-proxy" && proxies.length === 0) ||
    (transport.ingressMode !== "public-proxy" && proxies.length !== 0) ||
    proxies.some((ip) => isIP(ip) === 0 || !transport.peers.includes(ip))
  )
    throw new Error("ADMIN_TRANSPORT_INVALID");
  const adapter = new FastifyAdapter({
    logger: false,
    https: { key: transport.key, cert: transport.cert },
    trustProxy: false,
    bodyLimit: 8192,
    requestTimeout: 10000,
    connectionTimeout: 10000,
    keepAliveTimeout: 5000,
    maxRequestsPerSocket: 100,
  });
  const fastify = adapter.getInstance();
  let inFlight = 0;
  const admitted = new WeakSet<object>();
  fastify.addHook("onRequest", async (request, reply) => {
    reply.headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": "max-age=31536000",
    });
    const peer = request.raw.socket.remoteAddress?.replace(/^::ffff:/, "");
    const expectedHost = new URL(transport.origin).host;
    if (
      request.protocol !== "https" ||
      !peer ||
      !transport.peers.includes(peer) ||
      request.headers.host !== expectedHost ||
      request.headers.authorization !== undefined ||
      Object.keys(request.headers).some(
        (h) => h === "forwarded" || h.startsWith("x-forwarded-") || h.startsWith("x-auth-"),
      ) ||
      !/^\/v1\/admin\/[a-z0-9/-]+(?:\?[^#]*)?$/.test(request.raw.url ?? "")
    )
      return reply.code(403).send(body("FORBIDDEN"));
    let clientIp = peer;
    const forwardedIp = request.headers["x-hambazi-client-ip"];
    if (transport.ingressMode === "public-proxy" && transport.proxyPeers?.includes(peer)) {
      if (typeof forwardedIp !== "string" || isIP(forwardedIp) === 0)
        return reply.code(403).send(body("FORBIDDEN"));
      clientIp = forwardedIp;
    } else if (forwardedIp !== undefined) {
      return reply.code(403).send(body("FORBIDDEN"));
    }
    if (request.headers.origin !== undefined && request.headers.origin !== transport.origin)
      return reply.code(403).send(body("FORBIDDEN"));
    if (
      request.method !== "GET" &&
      (request.headers.origin !== transport.origin ||
        request.headers["content-type"]?.split(";")[0] !== "application/json")
    )
      return reply.code(403).send(body("FORBIDDEN"));
    if (inFlight >= transport.maxInFlight) return reply.code(429).send(body("RATE_LIMITED"));
    inFlight++;
    admitted.add(request);
    // Durable logout must remain possible during an ephemeral limiter outage.
    if (request.raw.url !== "/v1/admin/auth/logout" && !(await transport.admitIp(clientIp)))
      return reply.code(429).send(body("RATE_LIMITED"));
  });
  fastify.addHook("preHandler", async (request, reply) => {
    if (request.raw.url === "/v1/admin/auth/login") {
      const b = request.body;
      const username =
        typeof b === "object" && b !== null && "username" in b && typeof b.username === "string"
          ? b.username.toLowerCase().slice(0, 64)
          : "invalid";
      if (!(await transport.admitIdentity(username)))
        return reply.code(429).send(body("RATE_LIMITED"));
    }
    if (
      request.raw.url?.includes("?") &&
      !/^\/v1\/admin\/(users(?:\/search|\/[0-9a-f-]+\/(?:history|restrictions))?|games(?:\/search)?|rooms(?:\/search)?|matches(?:\/search|\/[0-9a-f-]+\/history)?|admins)\?/.test(
        request.raw.url,
      )
    )
      return reply.code(400).send(body("INVALID_INPUT"));
  });
  fastify.addHook("onResponse", async (request) => {
    if (admitted.delete(request)) inFlight--;
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    createAdminHttpModule(deps),
    adapter,
    { logger: false, abortOnError: false },
  );
  app.useGlobalFilters(new AdminExceptionFilter(deps.service));
  await app.init();
  return app;
}

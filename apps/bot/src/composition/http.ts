import { createCorrelation, withCorrelation } from "@hambazi/observability";
import Fastify from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { TLSSocket } from "node:tls";
import { createErrorEnvelope } from "@hambazi/contracts";
import { RetryDelivery, type Backend } from "../backend.js";
import { updateEnvelope } from "../updates.js";
import type { BotLogger } from "./logger.js";
export const webhookPath = "/v1/telegram/webhook";
export function createBotHttp(options: {
  tls: { key: { reveal(): string }; cert: string };
  secret: { reveal(): string };
  backend: Backend;
  handle(input: unknown, signal: AbortSignal): Promise<void>;
  timeoutMs: number;
  maxInFlight: number;
  logger: BotLogger;
}) {
  const server = Fastify({
    logger: false,
    trustProxy: false,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 65536,
    requestTimeout: 10000,
    connectionTimeout: 30000,
    keepAliveTimeout: 5000,
    maxRequestsPerSocket: 100,
    https: {
      key: options.tls.key.reveal(),
      cert: options.tls.cert,
      minVersion: "TLSv1.2",
      maxHeaderSize: 8192,
    },
  });
  const expected = Buffer.from(options.secret.reveal());
  const inflight = new Map<
    string,
    { controller: AbortController; timer: ReturnType<typeof setTimeout> }
  >();
  let draining = false;
  const active = new Set<Promise<void>>();
  server.addHook("onRequest", (request, _reply, done) => {
    withCorrelation(createCorrelation({ requestId: request.id }), done);
  });
  server.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
      .header("Strict-Transport-Security", "max-age=31536000")
      .header("X-Request-Id", req.id);
    if (req.method !== "POST" || req.url !== webhookPath)
      return reply.code(404).send(createErrorEnvelope("NOT_FOUND"));
    if (
      !(req.raw.socket instanceof TLSSocket) ||
      !req.raw.socket.encrypted ||
      Object.keys(req.headers).some(
        (k) => k === "origin" || k === "forwarded" || k.startsWith("x-forwarded-"),
      )
    )
      return reply.code(403).send(createErrorEnvelope("FORBIDDEN"));
    const values: string[] = [];
    for (let i = 0; i < req.raw.rawHeaders.length; i += 2)
      if (req.raw.rawHeaders[i]!.toLowerCase() === "x-telegram-bot-api-secret-token")
        values.push(req.raw.rawHeaders[i + 1]!);
    const supplied = Buffer.from(values[0] ?? "");
    if (
      values.length !== 1 ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return reply.code(401).send(createErrorEnvelope("UNAUTHENTICATED"));
    if (draining || inflight.size >= options.maxInFlight)
      return reply.header("Retry-After", "1").code(503).send(createErrorEnvelope("INTERNAL_ERROR"));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    inflight.set(req.id, { controller, timer });
    reply.raw.once("close", () => release(req.id));
    // Distributed admission runs before body parsing, including ignored update types.
    await options.backend.admit(controller.signal);
    controller.signal.throwIfAborted();
  });
  const release = (id: string) => {
    const item = inflight.get(id);
    if (item) {
      clearTimeout(item.timer);
      item.controller.abort();
      inflight.delete(id);
    }
  };
  server.addHook("onResponse", async (req, reply) => {
    release(req.id);
    options.logger.completed(req.id, reply.elapsedTime, reply.statusCode);
  });
  server.addHook("onRequestAbort", async (req) => release(req.id));
  server.setErrorHandler((error, _req, reply) => {
    const retry = error instanceof RetryDelivery;
    const status = retry
      ? 503
      : [400, 413, 415].includes(Number((error as { statusCode?: number }).statusCode))
        ? Number((error as { statusCode?: number }).statusCode)
        : 503;
    if (status === 503) reply.header("Retry-After", retry ? String(error.retryAfterSeconds) : "1");
    reply
      .code(status)
      .send(createErrorEnvelope(status === 503 ? "INTERNAL_ERROR" : "INVALID_INPUT"));
  });
  server.post(webhookPath, async (req, reply) => {
    if (!updateEnvelope.safeParse(req.body).success)
      return reply.code(400).send(createErrorEnvelope("INVALID_INPUT"));
    const state = inflight.get(req.id);
    if (!state) throw new RetryDelivery();
    const work = options.handle(req.body, state.controller.signal);
    active.add(work);
    try {
      await work;
    } finally {
      active.delete(work);
    }
    state.controller.signal.throwIfAborted();
    return reply.code(200).send({ ok: true });
  });
  let closing: Promise<void> | undefined;
  return {
    server,
    stopAdmission() {
      draining = true;
    },
    close() {
      draining = true;
      return (closing ??= (async () => {
        await server.close();
        await Promise.allSettled([...active]);
      })());
    },
  };
}

import "reflect-metadata";
import { Controller, Get, Module, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createErrorEnvelope } from "@hambazi/contracts";
import type { StatisticsPort } from "../application/service.js";
export interface StatisticsHttpDependencies {
  statistics: StatisticsPort;
  authenticate(token: string): Promise<
    | { ok: true; userId: string }
    | {
        ok: false;
        error: {
          code: "UNAUTHENTICATED" | "REGISTRATION_REQUIRED" | "INVALID_INPUT" | "INTERNAL_ERROR";
        };
      }
  >;
  rate(
    userId: string,
  ): Promise<
    | { allowed: true }
    | { allowed: false; reason: "unavailable" }
    | { allowed: false; reason: "limited"; retryAfterSeconds: number }
  >;
}
export function createStatisticsHttpModule(deps: StatisticsHttpDependencies) {
  function fail(
    reply: FastifyReply,
    code:
      | "UNAUTHENTICATED"
      | "REGISTRATION_REQUIRED"
      | "INVALID_INPUT"
      | "NOT_FOUND"
      | "INTERNAL_ERROR",
  ) {
    return reply
      .code(
        code === "REGISTRATION_REQUIRED"
          ? 401
          : code === "UNAUTHENTICATED"
            ? 401
            : code === "INVALID_INPUT"
              ? 400
              : code === "NOT_FOUND"
                ? 404
                : 503,
      )
      .send(createErrorEnvelope(code === "REGISTRATION_REQUIRED" ? "UNAUTHENTICATED" : code));
  }
  async function actor(req: FastifyRequest, reply: FastifyReply) {
    let count = 0;
    for (let i = 0; i < req.raw.rawHeaders.length; i += 2)
      if (req.raw.rawHeaders[i]?.toLowerCase() === "authorization") count++;
    const header = req.headers.authorization;
    const token =
      count === 1 && typeof header === "string" && header.length <= 4103
        ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header)?.[1]
        : undefined;
    if (!token) {
      fail(reply, "UNAUTHENTICATED");
      return;
    }
    const auth = await deps.authenticate(token);
    if (!auth.ok) {
      fail(reply, auth.error.code);
      return;
    }
    const decision = await deps
      .rate(auth.userId)
      .catch(() => ({ allowed: false as const, reason: "unavailable" as const }));
    if (!decision.allowed) {
      if (decision.reason === "limited")
        reply
          .header("Retry-After", decision.retryAfterSeconds)
          .code(429)
          .send(createErrorEnvelope("RATE_LIMITED"));
      else fail(reply, "INTERNAL_ERROR");
      return;
    }
    return auth.userId;
  }
  @Controller("v1")
  class StatisticsController {
    @Get("me/stats") async own(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
      const id = await actor(req, reply);
      if (!id) return;
      const result = await deps.statistics.own(id, req.query);
      return result.ok ? reply.code(200).send(result.value) : fail(reply, result.error.code);
    }
    @Get("leaderboards/:game") async board(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
      const id = await actor(req, reply);
      if (!id) return;
      const result = await deps.statistics.board(
        id,
        (req.params as { game?: unknown }).game,
        req.query,
      );
      return result.ok ? reply.code(200).send(result.value) : fail(reply, result.error.code);
    }
  }
  @Module({ controllers: [StatisticsController] })
  class StatisticsHttpModule {}
  return StatisticsHttpModule;
}

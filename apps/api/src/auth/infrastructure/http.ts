import "reflect-metadata";
import { Controller, Get, Module, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createErrorEnvelope } from "@hambazi/contracts";
import type { AuthSessions, SessionClock, SessionFailure } from "../application/session-ports.js";
import type { TelegramVerifier } from "../application/telegram-verifier.js";
import type { AuthRateLimiter, RateDecision } from "../application/rate-limit.js";
import type { MiniAppOnboarding } from "../application/mini-app-onboarding.js";
import {
  accountCreationSchema,
  accountCreatedSchema,
  inspectedSchema,
  issuanceSchema,
  issuedSchema,
  logoutSchema,
} from "./http-contract.js";

export function sendRateDecision(reply: FastifyReply, decision: RateDecision): boolean {
  if (decision.allowed) return false;
  if (decision.reason === "limited") {
    reply
      .header("Retry-After", decision.retryAfterSeconds)
      .code(429)
      .send(createErrorEnvelope("RATE_LIMITED"));
  } else reply.code(503).send(createErrorEnvelope("INTERNAL_ERROR"));
  return true;
}
function failure(reply: FastifyReply, result: SessionFailure, registeredEntry = false) {
  const code =
    result.error.code === "REGISTRATION_REQUIRED" && !registeredEntry
      ? "UNAUTHENTICATED"
      : result.error.code;
  return reply
    .code(
      code === "UNAUTHENTICATED"
        ? 401
        : code === "REGISTRATION_REQUIRED"
          ? 403
          : code === "INVALID_INPUT"
            ? 400
            : 503,
    )
    .send(createErrorEnvelope(code));
}
function bearer(request: FastifyRequest): string | undefined {
  const headers = request.raw.rawHeaders;
  let count = 0;
  for (let i = 0; i < headers.length; i += 2)
    if (headers[i]?.toLowerCase() === "authorization") count++;
  const value = request.headers.authorization;
  if (count !== 1 || typeof value !== "string" || value.length > 4103) return;
  return /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(value)?.[1];
}

/** Controllers translate only validated HTTP intents; sessions remain application-owned. */
export function createAuthHttpModule(deps: {
  sessions: AuthSessions;
  telegram: TelegramVerifier;
  clock: SessionClock;
  limiter: AuthRateLimiter;
  onboarding: MiniAppOnboarding;
}) {
  @Controller("v1/auth")
  class AuthController {
    @Post("telegram-mini-app/account")
    async createAccount(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      const parsed = accountCreationSchema.safeParse(request.body);
      if (!parsed.success || Buffer.byteLength(parsed.data.initData, "utf8") > 16384)
        return reply.code(400).send(createErrorEnvelope("INVALID_INPUT"));
      const verified = deps.telegram.verify(parsed.data.initData, deps.clock.nowMs());
      if (!verified.ok) return reply.code(401).send(createErrorEnvelope("UNAUTHENTICATED"));
      if (
        sendRateDecision(
          reply,
          await deps.limiter.consumeIdentity(verified.identity.telegramUserId),
        )
      )
        return;
      const result = await deps.onboarding.create(
        parsed.data.initData,
        parsed.data.commandId,
        parsed.data.displayName,
      );
      if (!result.ok) return failure(reply, result);
      const response = accountCreatedSchema.safeParse({
        schemaVersion: 1,
        account: result.account,
        ...(result.startParam !== undefined ? { startParam: result.startParam } : {}),
      });
      if (!response.success) return reply.code(500).send(createErrorEnvelope("INTERNAL_ERROR"));
      return reply.code(200).send(response.data);
    }
    @Post("telegram-mini-app/registered-session")
    async registeredSession(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      return this.issue(request, reply, true);
    }
    @Post("telegram-mini-app")
    async issue(
      @Req() request: FastifyRequest,
      @Res() reply: FastifyReply,
      registeredEntry = false,
    ) {
      const parsed = issuanceSchema.safeParse(request.body);
      if (!parsed.success || Buffer.byteLength(parsed.data.initData, "utf8") > 16384)
        return reply.code(400).send(createErrorEnvelope("INVALID_INPUT"));
      const verified = deps.telegram.verify(parsed.data.initData, deps.clock.nowMs());
      if (!verified.ok) return reply.code(401).send(createErrorEnvelope("UNAUTHENTICATED"));
      if (
        sendRateDecision(
          reply,
          await deps.limiter.consumeIdentity(verified.identity.telegramUserId),
        )
      )
        return;
      const result = await deps.sessions.issue(parsed.data.initData, parsed.data.commandId);
      if (!result.ok) return failure(reply, result, registeredEntry);
      // The sole credential reveal into a successful response. Never attach this to telemetry.
      const response = issuedSchema.safeParse({
        schemaVersion: 1,
        tokenType: "Bearer",
        accessToken: result.accessToken.reveal(),
        session: result.session,
      });
      if (!response.success) return reply.code(500).send(createErrorEnvelope("INTERNAL_ERROR"));
      return reply.code(200).send(response.data);
    }
    @Get("session")
    async inspect(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      const token = bearer(request);
      if (!token) return reply.code(401).send(createErrorEnvelope("UNAUTHENTICATED"));
      const result = await deps.sessions.authenticate(token);
      if (!result.ok) return failure(reply, result);
      const response = inspectedSchema.safeParse({ schemaVersion: 1, session: result.session });
      if (!response.success) return reply.code(500).send(createErrorEnvelope("INTERNAL_ERROR"));
      return reply.code(200).send(response.data);
    }
    @Post("logout")
    async logout(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      if (!logoutSchema.safeParse(request.body).success)
        return reply.code(400).send(createErrorEnvelope("INVALID_INPUT"));
      const token = bearer(request);
      if (!token) return reply.code(401).send(createErrorEnvelope("UNAUTHENTICATED"));
      const result = await deps.sessions.revoke(token);
      if (!result.ok) return failure(reply, result);
      return reply.code(200).send({ schemaVersion: 1, ok: true });
    }
  }
  @Module({ controllers: [AuthController] })
  class AuthHttpModule {}
  return AuthHttpModule;
}

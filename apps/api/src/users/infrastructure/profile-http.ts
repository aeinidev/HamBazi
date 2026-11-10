import "reflect-metadata";
import { Controller, Get, Patch, Module, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createErrorEnvelope } from "@hambazi/contracts";
import type { ProfilePort } from "../application/profile.js";
import type { ProfileRate } from "./profile-rate.js";
import { profileResponseSchema, profileAckSchema } from "./profile-contract.js";
import { z } from "zod";
import { usernameSchema } from "../application/profile.js";
export interface ProfileHttpDependencies {
  profile: ProfilePort;
  authenticate(token: string): Promise<
    | { ok: true; userId: string }
    | {
        ok: false;
        error: {
          code: "UNAUTHENTICATED" | "REGISTRATION_REQUIRED" | "INVALID_INPUT" | "INTERNAL_ERROR";
        };
      }
  >;
  rate: ProfileRate;
  degraded(requestId: string, kind: "read" | "write"): void;
}
export function createProfileHttpModule(deps: ProfileHttpDependencies) {
  function fail(
    reply: FastifyReply,
    code:
      | "UNAUTHENTICATED"
      | "REGISTRATION_REQUIRED"
      | "INVALID_INPUT"
      | "INTERNAL_ERROR"
      | "PROFILE_CONFLICT",
  ) {
    return reply
      .code(
        code === "REGISTRATION_REQUIRED"
          ? 401
          : code === "UNAUTHENTICATED"
            ? 401
            : code === "INVALID_INPUT"
              ? 400
              : code === "PROFILE_CONFLICT"
                ? 409
                : 503,
      )
      .send(createErrorEnvelope(code === "REGISTRATION_REQUIRED" ? "UNAUTHENTICATED" : code));
  }
  async function identity(req: FastifyRequest, reply: FastifyReply, kind: "read" | "write") {
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
      .rate(kind, auth.userId)
      .catch(() => ({ allowed: false as const, reason: "unavailable" as const }));
    if (!decision.allowed) {
      if (decision.reason === "limited") {
        reply
          .header("Retry-After", decision.retryAfterSeconds)
          .code(429)
          .send(createErrorEnvelope("RATE_LIMITED"));
        return;
      }
      deps.degraded(req.id, kind);
      if (kind === "write") {
        fail(reply, "INTERNAL_ERROR");
        return;
      }
    }
    return auth.userId;
  }
  @Controller("v1/me")
  class ProfileController {
    @Get("username-availability")
    async username(
      @Req() req: FastifyRequest,
      @Res() reply: FastifyReply,
      @Query() query: unknown,
    ) {
      const userId = await identity(req, reply, "read");
      if (!userId) return;
      const parsed = z.strictObject({ username: usernameSchema }).safeParse(query);
      if (!parsed.success) return fail(reply, "INVALID_INPUT");
      const result = await deps.profile.checkUsername(userId, parsed.data.username);
      if (!result.ok) return fail(reply, result.error.code);
      return reply.code(200).send({ schemaVersion: 1, available: result.available });
    }
    @Get()
    async read(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
      const userId = await identity(req, reply, "read");
      if (!userId) return;
      const result = await deps.profile.read(userId);
      if (!result.ok) return fail(reply, result.error.code);
      const response = profileResponseSchema.safeParse(result.profile);
      if (!response.success) return fail(reply, "INTERNAL_ERROR");
      return reply.code(200).send(response.data);
    }
    @Patch()
    async patch(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
      const userId = await identity(req, reply, "write");
      if (!userId) return;
      const result = await deps.profile.patch(userId, req.body);
      if (!result.ok) return fail(reply, result.error.code);
      const response = profileAckSchema.safeParse({
        schemaVersion: 1,
        commandId: result.commandId,
        appliedVersion: result.appliedVersion,
      });
      if (!response.success) return fail(reply, "INTERNAL_ERROR");
      return reply.code(200).send(response.data);
    }
  }
  @Module({ controllers: [ProfileController] })
  class ProfileHttpModule {}
  return ProfileHttpModule;
}

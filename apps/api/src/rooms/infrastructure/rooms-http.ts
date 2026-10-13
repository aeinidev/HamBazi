import "reflect-metadata";
import { Controller, Get, Post, Module, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createErrorEnvelope } from "@hambazi/contracts";
import type { RoomsPort } from "../application/rooms.js";
import type { RoomCode } from "../domain/room.js";
import type { RoomsRate } from "./rooms-rate.js";
import {
  roomAckSchema,
  roomResponseSchema,
  inviteResponseSchema,
  invitePreviewSchema,
} from "./rooms-contract.js";
export interface RoomsHttpDependencies {
  rooms: Pick<RoomsPort, "create" | "read"> &
    Partial<Pick<RoomsPort, "shareInvite" | "resolveInvite">>;
  authenticate(token: string): Promise<
    | { ok: true; userId: string }
    | {
        ok: false;
        error: {
          code: "UNAUTHENTICATED" | "REGISTRATION_REQUIRED" | "INVALID_INPUT" | "INTERNAL_ERROR";
        };
      }
  >;
  rate: RoomsRate;
}
export function createRoomsHttpModule(
  deps: RoomsHttpDependencies,
  prefix: "v1" | "v1/kahroba" = "v1",
) {
  function fail(reply: FastifyReply, code: RoomCode | "REGISTRATION_REQUIRED") {
    if (code === "RATE_LIMITED")
      return reply.header("Retry-After", 60).code(429).send(createErrorEnvelope(code));
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
                : code === "FORBIDDEN"
                  ? 403
                  : code === "ROOM_CONFLICT" || code === "GAME_UNAVAILABLE"
                    ? 409
                    : 503,
      )
      .send(createErrorEnvelope(code === "REGISTRATION_REQUIRED" ? "UNAUTHENTICATED" : code));
  }
  async function handle(
    req: FastifyRequest,
    reply: FastifyReply,
    operation: "create" | "read" | "shareInvite" | "resolveInvite",
  ) {
    try {
      let count = 0;
      for (let i = 0; i < req.raw.rawHeaders.length; i += 2)
        if (req.raw.rawHeaders[i]?.toLowerCase() === "authorization") count++;
      const header = req.headers.authorization;
      const token =
        count === 1 && typeof header === "string" && header.length <= 4103
          ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header)?.[1]
          : undefined;
      if (!token) return fail(reply, "UNAUTHENTICATED");
      const auth = await deps.authenticate(token);
      if (!auth.ok) return fail(reply, auth.error.code);
      const rate =
        operation === "create" || operation === "read"
          ? await deps.rate(operation, auth.userId)
          : { allowed: true as const };
      if (!rate.allowed) {
        if (rate.reason === "unavailable") return fail(reply, "INTERNAL_ERROR");
        return reply
          .header("Retry-After", rate.retryAfterSeconds)
          .code(429)
          .send(createErrorEnvelope("RATE_LIMITED"));
      }
      const result =
        operation === "shareInvite"
          ? await deps.rooms.shareInvite?.(auth.userId, (req.params as { id?: unknown }).id)
          : operation === "resolveInvite"
            ? await deps.rooms.resolveInvite?.(auth.userId, req.body)
            : operation === "create"
              ? await deps.rooms.create(auth.userId, req.body)
              : await deps.rooms.read(auth.userId, (req.params as { id?: unknown }).id);
      if (!result) return fail(reply, "NOT_FOUND");
      if (!result.ok) return fail(reply, result.error.code);
      const parsed = (
        operation === "shareInvite"
          ? inviteResponseSchema
          : operation === "resolveInvite"
            ? invitePreviewSchema
            : operation === "create"
              ? roomAckSchema
              : roomResponseSchema
      ).safeParse(result);
      return parsed.success
        ? reply.code(operation === "create" ? 201 : 200).send(parsed.data)
        : fail(reply, "INTERNAL_ERROR");
    } catch {
      return fail(reply, "INTERNAL_ERROR");
    }
  }
  @Controller(`${prefix}/rooms`)
  class RoomsController {
    @Post() create(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
      return handle(req, reply, "create");
    }
    @Get(":id/invite") share(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
      return handle(req, reply, "shareInvite");
    }
    @Get(":id") read(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
      return handle(req, reply, "read");
    }
  }
  @Controller(`${prefix}/room-invites`)
  class InvitesController {
    @Post("resolve") resolve(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
      return handle(req, reply, "resolveInvite");
    }
  }
  @Module({ controllers: [RoomsController, InvitesController] })
  class RoomsHttpModule {}
  return RoomsHttpModule;
}

import "reflect-metadata";
import { Controller, Get, Module, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createErrorEnvelope } from "@hambazi/contracts";
import type { LobbyAvailability } from "../application/availability.js";
import type { CatalogPort } from "../application/catalog.js";
import type { CatalogRate } from "./catalog-rate.js";
import {
  catalogResponseSchema,
  gameResponseSchema,
  lobbyAvailabilityResponseSchema,
} from "./catalog-contract.js";
export interface CatalogHttpDependencies {
  catalog: CatalogPort;
  lobbyAvailability?(userId: string): Promise<LobbyAvailability>;
  authenticate(token: string): Promise<
    | { ok: true; userId: string }
    | {
        ok: false;
        error: {
          code: "UNAUTHENTICATED" | "REGISTRATION_REQUIRED" | "INVALID_INPUT" | "INTERNAL_ERROR";
        };
      }
  >;
  rate: CatalogRate;
  degraded(requestId: string): void;
}
export function createCatalogHttpModule(deps: CatalogHttpDependencies) {
  function fail(
    reply: FastifyReply,
    code:
      | "UNAUTHENTICATED"
      | "REGISTRATION_REQUIRED"
      | "INVALID_INPUT"
      | "INTERNAL_ERROR"
      | "NOT_FOUND",
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
  async function read(
    req: FastifyRequest,
    reply: FastifyReply,
    detail: boolean,
    availability = false,
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
      const rate = await deps
        .rate(auth.userId)
        .catch(() => ({ allowed: false as const, reason: "unavailable" as const }));
      if (!rate.allowed) {
        if (rate.reason === "limited")
          return reply
            .header("Retry-After", rate.retryAfterSeconds)
            .code(429)
            .send(createErrorEnvelope("RATE_LIMITED"));
        deps.degraded(req.id);
      }
      if (detail) {
        const result = await deps.catalog.find((req.params as { slug?: unknown }).slug);
        if (!result.ok) return fail(reply, result.error.code);
        const response = gameResponseSchema.safeParse({ schemaVersion: 1, game: result.game });
        return response.success
          ? reply.code(200).send(response.data)
          : fail(reply, "INTERNAL_ERROR");
      }
      const result = await deps.catalog.list();
      if (!result.ok) return fail(reply, result.error.code);
      if (availability) {
        if (!deps.lobbyAvailability) return fail(reply, "INTERNAL_ERROR");
        const response = lobbyAvailabilityResponseSchema.safeParse({
          schemaVersion: 1,
          lobbyAvailability: await deps.lobbyAvailability(auth.userId),
        });
        return response.success
          ? reply.code(200).send(response.data)
          : fail(reply, "INTERNAL_ERROR");
      }
      const response = catalogResponseSchema.safeParse({ schemaVersion: 1, games: result.games });
      return response.success ? reply.code(200).send(response.data) : fail(reply, "INTERNAL_ERROR");
    } catch {
      return fail(reply, "INTERNAL_ERROR");
    }
  }
  @Controller("v1/games")
  class CatalogController {
    @Get()
    list(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
      return read(req, reply, false);
    }
    @Get("availability")
    availability(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
      return read(req, reply, false, true);
    }
    @Get(":slug")
    detail(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
      return read(req, reply, true);
    }
  }
  @Module({ controllers: [CatalogController] })
  class CatalogHttpModule {}
  return CatalogHttpModule;
}

import "reflect-metadata";
import { Controller, Get, Module, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createErrorEnvelope } from "@hambazi/contracts";
import type { AuthSessions, OwnerAdmission } from "../auth/index.js";
import type { PublicNamesPort } from "../users/index.js";
import type { MatchResyncPort } from "../matches/index.js";
import type { KahrobaRuntimeConfig } from "@hambazi/config";
import { kahrobaPlayerViewSchema, kahrobaSpectatorViewSchema } from "@hambazi/kahroba-engine";
export const kahrobaCapabilitiesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  gameId: z.literal("kahroba"),
  registered: z.boolean(),
  enabled: z.boolean(),
  admission: z.boolean(),
  minPlayers: z.literal(2),
  maxPlayers: z.union([z.literal(2), z.literal(4)]),
  engineVersion: z.literal("kahroba-v1"),
  stateSchemaVersion: z.literal(1),
  rulesetVersion: z.literal("kahroba-base-v1"),
  viewSchemaVersion: z.literal(1),
  turnDurationMs: z.null(),
  timeoutPolicyVersion: z.null(),
});
export const kahrobaPublicNamesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  players: z
    .array(z.strictObject({ userId: z.uuid(), displayName: z.string().min(1).max(256) }))
    .max(4),
});
export function createKahrobaHttpModule(deps: {
  sessions: Pick<AuthSessions, "authenticate">;
  admission: OwnerAdmission;
  config: KahrobaRuntimeConfig;
  resync: MatchResyncPort;
  names: PublicNamesPort;
  rate(userId: string): Promise<{ allowed: boolean }>;
}) {
  async function auth(req: FastifyRequest) {
    if (
      req.raw.rawHeaders.filter((_, i, a) => i % 2 === 0 && a[i]?.toLowerCase() === "authorization")
        .length !== 1
    )
      return undefined;
    const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
      req.headers.authorization ?? "",
    )?.[1];
    if (!token) return undefined;
    const result = await deps.sessions.authenticate(token);
    return result.ok && (await deps.admission.allowsUserId(result.session.userId))
      ? result.session.userId
      : undefined;
  }
  async function read(req: FastifyRequest, reply: FastifyReply, names = false) {
    try {
      const userId = await auth(req);
      if (!userId) return reply.code(401).send(createErrorEnvelope("UNAUTHENTICATED"));
      if (!(await deps.rate(userId)).allowed)
        return reply.code(429).send(createErrorEnvelope("RATE_LIMITED"));
      if (!names)
        return reply.send(
          kahrobaCapabilitiesSchema.parse({
            schemaVersion: 1,
            gameId: "kahroba",
            registered: deps.config.registered,
            enabled: deps.config.enabled,
            admission: deps.config.admission,
            minPlayers: 2,
            maxPlayers: deps.config.maxPlayers,
            engineVersion: "kahroba-v1",
            stateSchemaVersion: 1,
            rulesetVersion: "kahroba-base-v1",
            viewSchemaVersion: 1,
            turnDurationMs: null,
            timeoutPolicyVersion: null,
          }),
        );
      const matchId = z.uuid().safeParse((req.params as { id?: unknown }).id);
      if (!matchId.success) return reply.code(400).send(createErrorEnvelope("INVALID_INPUT"));
      const result = await deps.resync.snapshot(userId, {
        schemaVersion: 1,
        matchId: matchId.data,
      });
      if (!result.ok)
        return reply
          .code(result.error.code === "FORBIDDEN" ? 403 : 404)
          .send(createErrorEnvelope(result.error.code === "FORBIDDEN" ? "FORBIDDEN" : "NOT_FOUND"));
      const s = result.value;
      if (s.gameId !== "kahroba") return reply.code(404).send(createErrorEnvelope("NOT_FOUND"));
      if (s.view === null) return reply.send({ schemaVersion: 1, players: [] });
      const view = (
        s.role === "PLAYER" ? kahrobaPlayerViewSchema : kahrobaSpectatorViewSchema
      ).parse(s.view);
      return reply.send(
        kahrobaPublicNamesSchema.parse({
          schemaVersion: 1,
          players: await deps.names.find(view.players.map((p) => p.id)),
        }),
      );
    } catch {
      return reply.code(503).send(createErrorEnvelope("INTERNAL_ERROR"));
    }
  }
  @Controller("v1/kahroba")
  class KahrobaController {
    @Get("capabilities") capabilities(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
      return read(req, reply);
    }
    @Get("matches/:id/players") players(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
      return read(req, reply, true);
    }
  }
  @Module({ controllers: [KahrobaController] })
  class KahrobaHttpModule {}
  return KahrobaHttpModule;
}

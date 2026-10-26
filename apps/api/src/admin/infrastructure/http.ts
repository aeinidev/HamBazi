import "reflect-metadata";
import { Controller, Get, Post, Param, Req, Res, Module } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AdminService } from "../application/service.js";
import { AdminFault } from "../application/ports.js";
import {
  adminAccess,
  adminGameScope,
  type AdminCapability,
  type AdminPrincipal,
} from "../domain/access.js";
import { constantAdminEqual } from "./crypto.js";

export const adminCookie = "__Host-hambazi-admin";
export const adminPendingCookie = "__Host-hambazi-admin-pending";
function cookie(request: FastifyRequest, name: string) {
  const raw = request.headers.cookie;
  if (!raw || raw.length > 8192) return undefined;
  const matches = raw
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(name + "="));
  return matches.length === 1 ? matches[0]!.slice(name.length + 1) : undefined;
}
const querySchema = z.strictObject({
  cursor: z.string().max(128).optional(),
  limit: z
    .string()
    .regex(/^[1-9][0-9]?$/)
    .transform(Number)
    .pipe(z.number().max(50))
    .optional(),
});
export interface AdminReadPort {
  page(
    kind: "users" | "games" | "rooms" | "matches",
    query: { cursor?: string; id?: string; limit: number },
    games: readonly string[] | null,
  ): Promise<unknown>;
  overview(principal: AdminPrincipal): Promise<unknown>;
  audit(): Promise<unknown>;
}
/** Only composed into the separate private listener; no player-API registration. */
export function createAdminHttpModule(deps: {
  service: AdminService;
  csrf(id: string): string;
  reads: AdminReadPort;
  cookieSeconds: number;
  pendingSeconds: number;
}) {
  function setCookie(reply: FastifyReply, name: string, token: string, maxAge: number) {
    const other = name === adminCookie ? adminPendingCookie : adminCookie;
    reply.header("Set-Cookie", [
      `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`,
      `${other}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    ]);
  }
  async function authenticated(request: FastifyRequest, permission?: AdminCapability) {
    const a = await deps.service.authenticate(cookie(request, adminCookie));
    if (
      permission &&
      !adminAccess(a.principal, permission) &&
      adminGameScope(a.principal, permission)?.length === 0
    )
      throw new AdminFault("FORBIDDEN");
    return a;
  }
  async function csrf(request: FastifyRequest, pending = false) {
    if (pending) {
      // The signed pending token is validated again in service.pin. HMAC CSRF binding uses its opaque token-independent ID.
      const token = cookie(request, adminPendingCookie);
      if (!token) throw new AdminFault("UNAUTHENTICATED");
      const id = await deps.service.pendingSessionId(token);
      if (!constantAdminEqual(request.headers["x-csrf-token"], deps.csrf(id)))
        throw new AdminFault("FORBIDDEN");
      return token;
    }
    const a = await authenticated(request);
    if (!constantAdminEqual(request.headers["x-csrf-token"], deps.csrf(a.sessionId)))
      throw new AdminFault("FORBIDDEN");
    return cookie(request, adminCookie);
  }
  @Controller("v1/admin")
  class AdminController {
    @Post("auth/login")
    async login(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      const result = await deps.service.login(request.body);
      setCookie(
        reply,
        result.next === "PIN_REQUIRED" ? adminPendingCookie : adminCookie,
        result.token,
        result.next === "PIN_REQUIRED" ? deps.pendingSeconds : deps.cookieSeconds,
      );
      return reply.send({ schemaVersion: 1, next: result.next, csrfToken: result.csrfToken });
    }
    @Post("auth/pin")
    async pin(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      const token = await csrf(request, true);
      // Pending CSRF uses the verified signed token, never an untrusted body identity.
      const result = await deps.service.pin(token, request.body);
      setCookie(reply, adminCookie, result.token, deps.cookieSeconds);
      return reply.send({ schemaVersion: 1, next: result.next, csrfToken: result.csrfToken });
    }
    @Get("me/access")
    async access(@Req() request: FastifyRequest) {
      return deps.service.access(cookie(request, adminCookie));
    }
    @Get("session")
    async session(@Req() request: FastifyRequest) {
      const a = await authenticated(request);
      return { schemaVersion: 1, expiresAt: a.expiresAt, csrfToken: a.csrfToken };
    }
    @Post("auth/logout")
    async logout(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      const p = z
        .strictObject({ schemaVersion: z.literal(1), commandId: z.uuid() })
        .parse(request.body);
      const token = await csrf(request);
      await deps.service.logout(token, p.commandId);
      setCookie(reply, adminCookie, "", 0);
      return reply.send({ schemaVersion: 1, ok: true });
    }
    @Post("auth/pin/change")
    async change(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      const token = await csrf(request);
      await deps.service.changePin(token, request.body);
      setCookie(reply, adminCookie, "", 0);
      return reply.send({ schemaVersion: 1, ok: true });
    }
    @Get("overview")
    async overview(@Req() request: FastifyRequest) {
      const a = await authenticated(request, "overview.view");
      if (
        adminGameScope(a.principal, "overview.view") !== null ||
        !adminAccess(a.principal, "overview.view")
      )
        throw new AdminFault("FORBIDDEN");
      return deps.reads.overview(a.principal);
    }
    @Get("monitoring/summary")
    async monitoring(@Req() request: FastifyRequest) {
      const a = await authenticated(request, "monitoring.view");
      if (
        adminGameScope(a.principal, "monitoring.view") !== null ||
        !adminAccess(a.principal, "monitoring.view")
      )
        throw new AdminFault("FORBIDDEN");
      return deps.reads.overview(a.principal);
    }
    @Get("audit-events")
    async audit(@Req() request: FastifyRequest) {
      const a = await authenticated(request, "audit.view");
      if (
        adminGameScope(a.principal, "audit.view") !== null ||
        !adminAccess(a.principal, "audit.view")
      )
        throw new AdminFault("FORBIDDEN");
      return deps.reads.audit();
    }
    async page(
      kind: "users" | "games" | "rooms" | "matches",
      request: FastifyRequest,
      id?: string,
    ) {
      const p = querySchema.parse(request.query);
      if (id !== undefined)
        (kind === "games" ? z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) : z.uuid()).parse(id);
      if (p.cursor !== undefined)
        (kind === "games" ? z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) : z.uuid()).parse(p.cursor);
      const a = await authenticated(request, `${kind}.view`);
      const games = adminGameScope(a.principal, `${kind}.view`);
      if (games?.length === 0 || (kind === "users" && games !== null))
        throw new AdminFault("FORBIDDEN");
      return deps.reads.page(
        kind,
        {
          ...(p.cursor === undefined ? {} : { cursor: p.cursor }),
          ...(id === undefined ? {} : { id }),
          limit: id === undefined ? (p.limit ?? 25) : 1,
        },
        games,
      );
    }
    @Get("users") users(@Req() r: FastifyRequest) {
      return this.page("users", r);
    }
    @Get("games") games(@Req() r: FastifyRequest) {
      return this.page("games", r);
    }
    @Get("rooms") rooms(@Req() r: FastifyRequest) {
      return this.page("rooms", r);
    }
    @Get("matches") matches(@Req() r: FastifyRequest) {
      return this.page("matches", r);
    }
    @Get("users/:id") user(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.page("users", r, id);
    }
    @Get("games/:id") game(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.page("games", r, id);
    }
    @Get("rooms/:id") room(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.page("rooms", r, id);
    }
    @Get("matches/:id") match(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.page("matches", r, id);
    }
  }
  @Module({ controllers: [AdminController] })
  class AdminHttpModule {}
  return AdminHttpModule;
}

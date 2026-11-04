import "reflect-metadata";
import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  Module,
  SetMetadata,
  type ExecutionContext,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  adminExecuteSchema,
  adminUserQuerySchema,
  adminUserProfileSchema,
  adminUserRestrictionsSchema,
  adminUserHistorySchema,
  adminPrivateNoteSchema,
  adminGameSearchQuerySchema,
  adminRoomSearchQuerySchema,
  adminMatchSearchQuerySchema,
  adminGamePageSchema,
  adminRoomPageSchema,
  adminMatchPageSchema,
  adminGameDetailSchema,
  adminRoomDetailSchema,
  adminMatchDetailSchema,
  adminRoomPlayersSchema,
  adminMatchPlayersSchema,
  adminMatchHistorySchema,
  adminMatchHistoryQuerySchema,
  type AdminMatchHistoryQuery,
  type AdminGameSearchQuery,
  type AdminRoomSearchQuery,
  type AdminMatchSearchQuery,
} from "@hambazi/validation";
import { adminRoleTemplates } from "../application/management.js";
import type { AdminManagement } from "../application/management.js";
import type { AdminService } from "../application/service.js";
import { AdminFault } from "../application/ports.js";
import {
  adminAccess,
  adminCapabilities,
  adminGameScope,
  adminReadScope,
  type AdminCapability,
  type AdminPrincipal,
} from "../domain/access.js";
import { constantAdminEqual } from "./crypto.js";

export const adminCookie = "__Host-hambazi-admin";
export const adminPendingCookie = "__Host-hambazi-admin-pending";
const policyKey = "hambazi:admin:route-policy";
type RoutePolicy = "LOGIN" | "PENDING" | "SESSION" | AdminCapability;
const policy = (value: RoutePolicy) => SetMetadata(policyKey, value);
export function adminRequestCookie(request: FastifyRequest, name: string) {
  const raw = request.headers.cookie;
  if (!raw || raw.length > 8192) return undefined;
  const matches = raw
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(name + "="));
  return matches.length === 1 ? matches[0]!.slice(name.length + 1) : undefined;
}
const cookie = adminRequestCookie;
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
    query: {
      cursor?: string;
      id?: string;
      limit: number;
      search?: string;
      status?: "ACTIVE" | "BANNED";
    },
    games: readonly string[] | null,
    excluded?: readonly string[],
  ): Promise<unknown>;
  userDetail?(
    kind: "profile" | "history" | "restrictions",
    id: string,
    query: { cursor?: string; limit: number },
  ): Promise<unknown>;
  management?(
    resource: "games" | "rooms" | "matches",
    kind: "search" | "details" | "players" | "history",
    id: string | undefined,
    query:
      AdminGameSearchQuery | AdminRoomSearchQuery | AdminMatchSearchQuery | AdminMatchHistoryQuery,
    games: readonly string[] | null,
    excluded?: readonly string[],
  ): Promise<unknown>;
  restrictionsEnabled?: boolean;
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
  management?: AdminManagement | undefined;
}) {
  function management() {
    if (!deps.management) throw new AdminFault("ADMIN_UNAVAILABLE");
    return deps.management;
  }
  const authenticatedRequests = new WeakMap<
    FastifyRequest,
    ReturnType<AdminService["authenticate"]>
  >();
  function setCookie(reply: FastifyReply, name: string, token: string, maxAge: number) {
    const other = name === adminCookie ? adminPendingCookie : adminCookie;
    reply.header("Set-Cookie", [
      `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`,
      `${other}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    ]);
  }
  async function authenticated(request: FastifyRequest, permission?: AdminCapability) {
    let promise = authenticatedRequests.get(request);
    if (!promise) {
      // Polling effective permissions must not extend the idle timeout.
      promise = deps.service.authenticate(
        cookie(request, adminCookie),
        request.raw.url !== "/v1/admin/me/access",
      );
      authenticatedRequests.set(request, promise);
    }
    const a = await promise;
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
    @policy("SESSION")
    @Get("management/meta")
    metadata() {
      return {
        schemaVersion: 1,
        permissions: adminCapabilities,
        templates: adminRoleTemplates,
        enabled: !!deps.management,
        restrictionsEnabled: deps.reads.restrictionsEnabled ?? false,
      };
    }
    @policy("admins.view")
    @Get("admins")
    directory(@Req() request: FastifyRequest) {
      const p = z.strictObject({ cursor: z.uuid().optional() }).parse(request.query);
      return management().directory(cookie(request, adminCookie), p.cursor);
    }
    @policy("admins.view")
    @Get("admins/:id/activity")
    activity(@Req() request: FastifyRequest, @Param("id") id: string) {
      return management().activity(cookie(request, adminCookie), id);
    }
    @policy("admins.view")
    @Get("admins/:id/sessions")
    sessions(@Req() request: FastifyRequest, @Param("id") id: string) {
      return management().sessions(cookie(request, adminCookie), id);
    }
    @policy("SESSION")
    @Get("operations")
    operations(@Req() request: FastifyRequest) {
      return management().list(cookie(request, adminCookie));
    }
    @policy("users.restrictions.notes.view")
    @Get("operations/:id/private-note")
    async privateNote(@Req() request: FastifyRequest, @Param("id") id: string) {
      return adminPrivateNoteSchema.parse(
        await management().privateNote(cookie(request, adminCookie), id),
      );
    }
    @policy("SESSION")
    @Get("operations/:id")
    operation(@Req() request: FastifyRequest, @Param("id") id: string) {
      return management().status(cookie(request, adminCookie), id);
    }
    @policy("SESSION")
    @Post("operations")
    requestOperation(@Req() request: FastifyRequest) {
      return management().request(cookie(request, adminCookie), request.body);
    }
    @policy("SESSION")
    @Post("operations/:id/approve")
    async approveOperation(
      @Req() request: FastifyRequest,
      @Param("id") id: string,
      @Res() reply: FastifyReply,
    ) {
      const result = await management().approve(cookie(request, adminCookie), id, request.body);
      setCookie(reply, adminCookie, result.token, deps.cookieSeconds);
      return reply.send({ schemaVersion: 1, next: result.next, csrfToken: result.csrfToken });
    }
    @policy("SESSION")
    @Post("operations/:id/renew")
    renewOperation(@Req() request: FastifyRequest, @Param("id") id: string) {
      const p = adminExecuteSchema.parse(request.body);
      if (p.commandId !== id) throw new AdminFault("INVALID_INPUT");
      return management().renew(cookie(request, adminCookie), id);
    }
    @policy("SESSION")
    @Post("operations/:id/execute")
    executeOperation(@Req() request: FastifyRequest, @Param("id") id: string) {
      const p = adminExecuteSchema.parse(request.body);
      if (p.commandId !== id) throw new AdminFault("INVALID_INPUT");
      return management().execute(cookie(request, adminCookie), id);
    }
    @policy("LOGIN")
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
    @policy("PENDING")
    @Post("auth/pin")
    async pin(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      const token = await csrf(request, true);
      // Pending CSRF uses the verified signed token, never an untrusted body identity.
      const result = await deps.service.pin(token, request.body);
      setCookie(reply, adminCookie, result.token, deps.cookieSeconds);
      return reply.send({ schemaVersion: 1, next: result.next, csrfToken: result.csrfToken });
    }
    @policy("SESSION")
    @Get("me/access")
    async access(@Req() request: FastifyRequest) {
      return deps.service.access(cookie(request, adminCookie));
    }
    @policy("SESSION")
    @Get("session")
    async session(@Req() request: FastifyRequest) {
      const a = await authenticated(request);
      return { schemaVersion: 1, expiresAt: a.expiresAt, csrfToken: a.csrfToken };
    }
    @policy("SESSION")
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
    @policy("SESSION")
    @Post("auth/pin/change")
    async change(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      const token = await csrf(request);
      await deps.service.changePin(token, request.body);
      setCookie(reply, adminCookie, "", 0);
      return reply.send({ schemaVersion: 1, ok: true });
    }
    @policy("SESSION")
    @Post("auth/password/change")
    async changePassword(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      const token = await csrf(request);
      await deps.service.changePassword(token, request.body);
      setCookie(reply, adminCookie, "", 0);
      return reply.send({ schemaVersion: 1, ok: true });
    }
    @policy("overview.view")
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
    @policy("monitoring.view")
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
    @policy("audit.view")
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
      searching = false,
    ) {
      const p: {
        cursor?: string | undefined;
        limit?: number | undefined;
        search?: string | undefined;
        status?: "ACTIVE" | "BANNED" | undefined;
      } = searching ? adminUserQuerySchema.parse(request.query) : querySchema.parse(request.query);
      if (id !== undefined)
        (kind === "games" ? z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) : z.uuid()).parse(id);
      if (p.cursor !== undefined)
        (kind === "games" ? z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) : z.uuid()).parse(p.cursor);
      const a = await authenticated(request, `${kind}.view`);
      const { games, excluded } = adminReadScope(a.principal, `${kind}.view`);
      if (games?.length === 0 || (kind === "users" && games !== null))
        throw new AdminFault("FORBIDDEN");
      return deps.reads.page(
        kind,
        {
          ...(p.cursor === undefined ? {} : { cursor: p.cursor }),
          ...(id === undefined ? {} : { id }),
          ...(p.search !== undefined ? { search: p.search } : {}),
          ...(p.status !== undefined ? { status: p.status } : {}),
          limit: id === undefined ? (p.limit ?? 25) : 1,
        },
        games,
        excluded,
      );
    }
    async resourceManagement(
      resource: "games" | "rooms" | "matches",
      request: FastifyRequest,
      id?: string,
    ) {
      const a = await authenticated(request, `${resource}.view`);
      const { games, excluded } = adminReadScope(a.principal, `${resource}.view`);
      if (games?.length === 0) throw new AdminFault("FORBIDDEN");
      const schemas = {
        games: {
          query: adminGameSearchQuerySchema,
          page: adminGamePageSchema,
          detail: adminGameDetailSchema,
        },
        rooms: {
          query: adminRoomSearchQuerySchema,
          page: adminRoomPageSchema,
          detail: adminRoomDetailSchema,
        },
        matches: {
          query: adminMatchSearchQuerySchema,
          page: adminMatchPageSchema,
          detail: adminMatchDetailSchema,
        },
      };
      const selected = schemas[resource];
      const query =
        id === undefined
          ? selected.query.parse(request.query)
          : z.strictObject({}).parse(request.query);
      if (id !== undefined)
        (resource === "games" ? z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) : z.uuid()).parse(id);
      if (!deps.reads.management) throw new AdminFault("ADMIN_UNAVAILABLE");
      const raw = await deps.reads.management(
        resource,
        id === undefined ? "search" : "details",
        id,
        query,
        games,
        excluded,
      );
      if (raw === null) throw new AdminFault("FORBIDDEN");
      return (id === undefined ? selected.page : selected.detail).parse(raw);
    }
    async resourceMetadata(
      resource: "rooms" | "matches",
      kind: "players" | "history",
      request: FastifyRequest,
      id: string,
    ) {
      const permission =
        kind === "players" ? (`${resource}.players.view` as const) : "matches.history.view";
      const a = await authenticated(request, `${resource}.view`);
      const { games, excluded } = adminReadScope(a.principal, `${resource}.view`, permission);
      if (games?.length === 0) throw new AdminFault("FORBIDDEN");
      z.uuid().parse(id);
      const query =
        kind === "history"
          ? adminMatchHistoryQuerySchema.parse(request.query)
          : z.strictObject({}).parse(request.query);
      if (!deps.reads.management) throw new AdminFault("ADMIN_UNAVAILABLE");
      const raw = await deps.reads.management(resource, kind, id, query, games, excluded);
      if (raw === null) throw new AdminFault("FORBIDDEN");
      return (
        kind === "history"
          ? adminMatchHistorySchema
          : resource === "rooms"
            ? adminRoomPlayersSchema
            : adminMatchPlayersSchema
      ).parse(raw);
    }
    @policy("rooms.players.view")
    @Get("rooms/:id/players")
    roomPlayers(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.resourceMetadata("rooms", "players", r, id);
    }
    @policy("matches.players.view")
    @Get("matches/:id/players")
    matchPlayers(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.resourceMetadata("matches", "players", r, id);
    }
    @policy("matches.history.view")
    @Get("matches/:id/history")
    matchHistory(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.resourceMetadata("matches", "history", r, id);
    }
    @policy("games.view")
    @Get("games/search")
    searchGames(@Req() r: FastifyRequest) {
      return this.resourceManagement("games", r);
    }
    @policy("rooms.view")
    @Get("rooms/search")
    searchRooms(@Req() r: FastifyRequest) {
      return this.resourceManagement("rooms", r);
    }
    @policy("matches.view")
    @Get("matches/search")
    searchMatches(@Req() r: FastifyRequest) {
      return this.resourceManagement("matches", r);
    }
    @policy("games.view")
    @Get("games/:id/details")
    gameDetails(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.resourceManagement("games", r, id);
    }
    @policy("rooms.view")
    @Get("rooms/:id/details")
    roomDetails(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.resourceManagement("rooms", r, id);
    }
    @policy("matches.view")
    @Get("matches/:id/details")
    matchDetails(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.resourceManagement("matches", r, id);
    }
    @policy("users.view")
    @Get("users/search")
    searchUsers(@Req() r: FastifyRequest) {
      return this.page("users", r, undefined, true);
    }
    @policy("users.view")
    @Get("users")
    users(@Req() r: FastifyRequest) {
      return this.page("users", r);
    }
    @policy("games.view")
    @Get("games")
    games(@Req() r: FastifyRequest) {
      return this.page("games", r);
    }
    @policy("rooms.view")
    @Get("rooms")
    rooms(@Req() r: FastifyRequest) {
      return this.page("rooms", r);
    }
    @policy("matches.view")
    @Get("matches")
    matches(@Req() r: FastifyRequest) {
      return this.page("matches", r);
    }
    async userDetail(
      kind: "profile" | "history" | "restrictions",
      request: FastifyRequest,
      id: string,
    ) {
      z.uuid().parse(id);
      const p = querySchema.parse(request.query);
      if (p.cursor) z.uuid().parse(p.cursor);
      const permission =
        kind === "profile"
          ? "users.view"
          : kind === "history"
            ? "users.history.view"
            : "users.restrictions.view";
      const a = await authenticated(request, permission);
      if (
        !adminAccess(a.principal, "users.view") ||
        adminGameScope(a.principal, permission) !== null
      )
        throw new AdminFault("FORBIDDEN");
      if (!deps.reads.userDetail) throw new AdminFault("ADMIN_UNAVAILABLE");
      const raw = await deps.reads.userDetail(kind, id, {
        ...(p.cursor ? { cursor: p.cursor } : {}),
        limit: p.limit ?? 25,
      });
      if (raw === null) throw new AdminFault("FORBIDDEN");
      return (
        kind === "profile"
          ? adminUserProfileSchema
          : kind === "history"
            ? adminUserHistorySchema
            : adminUserRestrictionsSchema
      ).parse(raw);
    }
    @policy("users.view")
    @Get("users/:id/profile")
    userProfile(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.userDetail("profile", r, id);
    }
    @policy("users.history.view")
    @Get("users/:id/history")
    userHistory(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.userDetail("history", r, id);
    }
    @policy("users.restrictions.view")
    @Get("users/:id/restrictions")
    userRestrictions(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.userDetail("restrictions", r, id);
    }
    @policy("users.view")
    @Get("users/:id")
    user(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.page("users", r, id);
    }
    @policy("games.view")
    @Get("games/:id")
    game(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.page("games", r, id);
    }
    @policy("rooms.view")
    @Get("rooms/:id")
    room(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.page("rooms", r, id);
    }
    @policy("matches.view")
    @Get("matches/:id")
    match(@Req() r: FastifyRequest, @Param("id") id: string) {
      return this.page("matches", r, id);
    }
  }
  @Module({
    controllers: [AdminController],
    providers: [
      {
        provide: APP_GUARD,
        useValue: {
          async canActivate(context: ExecutionContext) {
            const value: unknown = Reflect.getMetadata(policyKey, context.getHandler());
            const request = context.switchToHttp().getRequest<FastifyRequest>();
            // New controllers/handlers are closed until a registered policy is explicitly declared.
            if (value === "LOGIN") return true;
            if (value === "PENDING") {
              await csrf(request, true);
              return true;
            }
            if (value !== "SESSION" && !adminCapabilities.includes(value as AdminCapability))
              throw new AdminFault("FORBIDDEN");
            await authenticated(
              request,
              value === "SESSION" ? undefined : (value as AdminCapability),
            );
            if (request.method !== "GET") await csrf(request);
            return true;
          },
        },
      },
    ],
  })
  class AdminHttpModule {}
  return AdminHttpModule;
}

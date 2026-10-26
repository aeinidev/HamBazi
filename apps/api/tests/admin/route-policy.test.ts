import "reflect-metadata";
import { APP_GUARD } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { describe, it, expect } from "vitest";
import { createAdminHttpModule } from "../../src/admin/infrastructure/http.js";
import type { AdminService } from "../../src/admin/application/service.js";

describe("default-closed Admin route registration", () => {
  it.each([undefined, "unregistered.manage"])(
    "denies a new handler without a registered policy: %s",
    async (value) => {
      const module = createAdminHttpModule({
        service: {} as AdminService,
        csrf: () => "",
        cookieSeconds: 60,
        pendingSeconds: 30,
        reads: { page: async () => null, overview: async () => null, audit: async () => null },
      });
      const providers = Reflect.getMetadata("providers", module) as {
        provide: unknown;
        useValue: { canActivate(context: ExecutionContext): Promise<boolean> };
      }[];
      const guard = providers.find((p) => p.provide === APP_GUARD)!.useValue;
      const handler = () => {};
      if (value !== undefined) Reflect.defineMetadata("hambazi:admin:route-policy", value, handler);
      const context = {
        getHandler: () => handler,
        switchToHttp: () => ({ getRequest: () => ({ method: "GET" }) }),
      } as unknown as ExecutionContext;
      await expect(guard.canActivate(context)).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );
});

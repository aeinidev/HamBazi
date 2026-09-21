import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { architecture } from "../index.mjs";
import { auditManifests, auditResolution } from "../architecture-audit.mjs";
import { createPolicy, readWorkspaces } from "../architecture-policy.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const workspaces = readWorkspaces(root);
// Deliberately declare invalid dependencies in lint fixtures to exercise the
// source rule independently of the separate manifest gate.
const fixtures = workspaces.map((workspace) => ({
  ...workspace,
  manifest: {
    ...workspace.manifest,
    dependencies: {
      ...Object.fromEntries(
        workspaces
          .filter((item) => !item.directory.startsWith("tooling/"))
          .map((item) => [item.name, "workspace:*"]),
      ),
      "@nestjs/common": "fixture",
      "@prisma/client": "fixture",
      pg: "fixture",
      redis: "fixture",
      "socket.io": "fixture",
      grammy: "fixture",
      zod: "fixture",
    },
    ...(workspace.id === "api"
      ? {
          exports: {
            ...workspace.manifest.exports,
            "./matches": { types: "./dist/matches/index.d.ts", import: "./dist/matches/index.js" },
          },
        }
      : {}),
  },
}));

function linter(inventory = fixtures) {
  return new ESLint({
    cwd: root,
    overrideConfigFile: true,
    allowInlineConfig: false,
    overrideConfig: [architecture(root, inventory)],
  });
}
async function messages(source, filePath, inventory) {
  const [result] = await linter(inventory).lintText(source, { filePath: resolve(root, filePath) });
  expect(result.messages.some((message) => message.fatal)).toBe(false);
  return result.messages;
}
const api = (owner, file = "application/service.ts") => `apps/api/src/${owner}/${file}`;
const engine = "packages/games/coup-engine/src/engine.ts";
const repository = (owner) => api(owner, "infrastructure/repositories/postgres.ts");

describe("source ownership boundaries", () => {
  it("allows only Auth repositories to select session storage", async () => {
    expect(
      await messages(
        'import { createDatabase } from "@hambazi/database"; db.forModule("auth").execute(db => db.session.findUnique({where:{id}}));',
        repository("auth"),
      ),
    ).toEqual([]);
    expect((await messages('db.forModule("users");', repository("auth"))).length).toBeGreaterThan(
      0,
    );
    expect(
      (await messages("db.session.findUnique({where:{id}});", repository("users"))).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await messages(
          "db.session.findUnique({where:{id},include:{user:true}});",
          repository("auth"),
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (await messages('import { createDatabase } from "@hambazi/database";', api("auth"))).length,
    ).toBeGreaterThan(0);
  });
  it("keeps Bot onboarding metadata inside Auth repositories", async () => {
    for (const delegate of ["botUpdateReceipt", "botOnboardingFlow"]) {
      expect(
        await messages(`db.${delegate}.findMany({where:{botId:123n}});`, repository("auth")),
      ).toEqual([]);
      expect(
        (await messages(`db.${delegate}.findMany({});`, repository("users"))).length,
      ).toBeGreaterThan(0);
    }
  });
  it.each([
    [api("auth"), 'import type { UserPort } from "../../users/index.js";'],
    [api("rooms"), 'export { UsersPort } from "../../users/index.js";'],
    [api("matchmaking"), 'import { createMatch } from "../../matches/index.js";'],
    [api("matches"), 'import type { GameEngine } from "@hambazi/game-core";'],
    [api("users"), 'import { User } from "../domain/user.js";'],
    [api("users", "domain/model.ts"), 'import { Handle } from "./handle.js";'],
    ["apps/api/src/composition/games.ts", 'import { engine } from "@hambazi/coup-engine";'],
    ["apps/api/src/index.ts", 'import { createDatabase } from "@hambazi/database";'],
    ["apps/worker/src/composition/main.ts", 'import { createDatabase } from "@hambazi/database";'],
    ["apps/worker/src/jobs/timeout.ts", 'import { timeout } from "@hambazi/api/matches";'],
    [repository("users"), 'import type { DatabaseOwner } from "@hambazi/database";'],
    [engine, 'import type { Clock } from "@hambazi/game-core";'],
    [engine, 'import { validate } from "@hambazi/validation";'],
    ["packages/shared/src/index.ts", 'export { Error } from "./errors.js";'],
    ["packages/shared/src/index.ts", "const first = items[0];"],
    ["apps/web/src/features/room/index.ts", 'import { Profile } from "../profile/index.js";'],
    ["apps/web/src/index.ts", 'import { Coup } from "./games/coup/index.js";'],
  ])("accepts a public/owned import from %s", async (file, source) => {
    expect(await messages(source, file)).toEqual([]);
  });

  it.each([
    [api("auth"), 'import { room } from "../../rooms/index.js";'],
    [api("users"), 'import { auth } from "../../auth/index.js";'],
    [api("rooms"), 'import { createMatch } from "../../matches/index.js";'],
    [api("leaderboard"), 'import { state } from "../../matches/index.js";'],
    [api("chat"), 'import { state } from "../../matches/domain/state.js";'],
    ["apps/api/src/index.ts", 'export * from "./users/infrastructure/repositories/postgres.js";'],
    [api("users", "index.ts"), 'export * from "./infrastructure/repositories/postgres.js";'],
    [api("users"), 'import { db } from "../infrastructure/repositories/postgres.js";'],
    [api("users", "domain/user.ts"), 'import { Injectable } from "@nestjs/common";'],
    [api("users", "domain/user.ts"), 'import { UseCase } from "../application/service.js";'],
    [api("rooms"), 'import { engine } from "@hambazi/coup-engine";'],
    [api("matches"), 'import { engine } from "@hambazi/coup-engine";'],
    [api("chat"), 'import { createDatabase } from "@hambazi/database";'],
    ["apps/worker/src/jobs/timeout.ts", 'import { createDatabase } from "@hambazi/database";'],
    ["apps/worker/src/index.ts", 'import { start } from "@hambazi/api";'],
    ["apps/bot/src/index.ts", 'import { createDatabase } from "@hambazi/database";'],
    ["apps/web/src/index.ts", 'import { createDatabase } from "@hambazi/database";'],
    ["packages/contracts/src/index.ts", 'export type { Prisma } from "@prisma/client";'],
    [api("users"), 'import { Pool } from "pg";'],
    [api("users"), 'import { raw } from "@hambazi/database/src/database.js";'],
    [engine, 'import { Clock } from "../../game-core/src/index.js";'],
    ["packages/contracts/src/index.ts", 'import { ErrorCode } from "../../shared/src/index.js";'],
    ["packages/shared/src/index.ts", 'import { fixture } from "../tests/fixture.js";'],
    ["packages/shared/src/index.ts", 'import { compiled } from "../dist/index.js";'],
    ["apps/api/src/mystery/index.ts", "export {};"],
    [
      "apps/web/src/features/room/index.ts",
      'import { hidden } from "../../games/coup/store/index.js";',
    ],
    [api("users"), 'import { x } from "#private";'],
    [api("users"), 'import { x } from "/tmp/private.ts";'],
    [api("users"), 'import { x } from "file:///tmp/private.ts";'],
    [api("users"), 'import { x } from "../../users/index.js?raw";'],
  ])("rejects an invalid ownership edge from %s: %s", async (file, source) => {
    expect(await messages(source, file)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "hambazi/boundaries", severity: 2 }),
      ]),
    );
  });

  it.each([
    'import type { State } from "@prisma/client";',
    'export * from "@prisma/client";',
    'export type { State } from "@prisma/client";',
    'const load = import("@prisma/client");',
    'type State = import("@prisma/client").State;',
    'import prisma = require("@prisma/client");',
    'const prisma = require("@prisma/client");',
    "const load = import(name);",
    "const load = import(`@prisma/client`);",
    "const load = require(name);",
    "const load = require;",
    'const value = module.require("@prisma/client");',
    'import { createRequire } from "node:module";',
    'eval("import(name)");',
  ])("checks alternate import/loading syntax: %s", async (source) => {
    expect(
      (await messages(source, engine)).some((message) => message.ruleId === "hambazi/boundaries"),
    ).toBe(true);
  });

  it.each([
    "@nestjs/common",
    "@prisma/client",
    "redis",
    "socket.io",
    "grammy",
    "node:fs",
    "fs",
    "node:crypto",
  ])("keeps %s out of the engine", async (dependency) => {
    expect(
      (await messages(`import { value } from "${dependency}";`, engine)).length,
    ).toBeGreaterThan(0);
  });

  it("rejects undeclared and dev-only production imports", async () => {
    for (const name of ["zod", "typescript"]) {
      expect(
        await messages(
          `import { value } from "${name}";`,
          "packages/shared/src/index.ts",
          workspaces,
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining("declare their dependency") }),
        ]),
      );
    }
  });

  it("does not let inline disables bypass the dedicated gate", async () => {
    expect(
      (
        await messages(
          '/* eslint-disable hambazi/boundaries */\nimport { value } from "pg";',
          engine,
        )
      ).some((message) => message.ruleId === "hambazi/boundaries"),
    ).toBe(true);
  });

  it("validates real production dependency directions", () => {
    const policy = createPolicy(root);
    expect(
      policy.checkImport(resolve(root, "packages/validation/src/schemas.ts"), "@hambazi/contracts"),
    ).toBeUndefined();
    expect(
      policy.checkImport(resolve(root, "packages/config/src/runtime.ts"), "zod"),
    ).toBeUndefined();
  });
  it("resolves a symlink before checking relative ownership", () => {
    const temporary = mkdtempSync(resolve(tmpdir(), "hambazi-boundaries-"));
    try {
      const source = resolve(temporary, "packages/shared/src");
      mkdirSync(source, { recursive: true });
      symlinkSync(resolve(root, "packages/database/src/index.ts"), resolve(source, "alias.ts"));
      expect(
        createPolicy(temporary, workspaces).checkImport(resolve(source, "index.ts"), "./alias.js"),
      ).toContain("declared workspace");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});

describe("engine determinism", () => {
  it.each([
    "Date.now();",
    "new Date();",
    "const now = Date.now;",
    "const { now } = Date;",
    "Math.random();",
    'Math["random"]();',
    "Math[method]();",
    "const { random } = Math;",
    "const math = Math;",
    "globalThis.Math.random();",
    "crypto.randomUUID();",
    "performance.now();",
    "setTimeout(run, 1);",
    "fetch(url);",
    "console.log(state);",
  ])("rejects ambient dependency: %s", async (source) => {
    expect(
      (await messages(source, engine)).some(
        (message) => message.ruleId === "hambazi/engine-determinism",
      ),
    ).toBe(true);
  });
  it.each([
    "Math.floor(1.2);",
    "const now = clock.now(); const draw = random.next();",
    "function sample(Date: { now(): number }) { return Date.now(); }",
  ])("allows deterministic/injected code: %s", async (source) => {
    expect(await messages(source, engine)).toEqual([]);
  });
});

describe("database ownership", () => {
  it.each(["users", "games", "rooms", "matches", "chat", "leaderboard"])(
    "accepts the literal database owner in its repository: %s",
    async (owner) => {
      expect(await messages(`database.forModule("${owner}");`, repository(owner))).toEqual([]);
    },
  );
  it("allows the narrower outbox scope only inside the Matches repository owner", async () => {
    expect(await messages('database.forModule("outbox");', repository("matches"))).toEqual([]);
    expect(
      (await messages('database.forModule("outbox");', repository("users"))).length,
    ).toBeGreaterThan(0);
  });
  it.each([
    'const repo = database.forModule("users");',
    "db.user.findMany({ where: { status: input }, select: { id: true, displayName: true }, take: limit });",
    "db.userSettings.update({ where: { userId }, data: { settingsJsonb: untrustedButValidatedJson } });",
    'db.user.findMany({ where: { OR: [{ id }, { status: "active" }] } });',
    "db.user.count();",
  ])("accepts owned scalar queries: %s", async (source) => {
    expect(await messages(source, repository("users"))).toEqual([]);
  });
  it.each([
    'database.forModule("matches");',
    "database.forModule(owner);",
    "const select = database.forModule;",
    "const { forModule: choose } = database;",
    'database["forModule"]("matches");',
    "db.match.findMany();",
    "const users = db.user; users.findMany();",
    "db.user.findMany({ include: { hostedRooms: true } });",
    "db.user.findMany({ select: { hostedRooms: true } });",
    "db.user.findMany({ select: { _count: true } });",
    "db.user.findMany({ where: { hostedRooms: { some: {} } } });",
    "db.user.create({ data: { hostedRooms: { create: {} } } });",
    "db.user.findMany(options);",
    "db.user.findMany({ where: filters });",
    "db.user.findMany({ ...options });",
    "db.user.findMany({ select: { [field]: true } });",
    "db.$queryRaw`SELECT * FROM matches`;",
    'db["$executeRawUnsafe"](sql);',
  ])("rejects unsafe ownership/query structure: %s", async (source) => {
    expect(
      (await messages(source, repository("users"))).some(
        (message) => message.ruleId === "hambazi/database-ownership",
      ),
    ).toBe(true);
  });
  it.each([api("users"), "apps/worker/src/jobs/timeout.ts", "apps/api/src/composition/main.ts"])(
    "does not select ownership in adapters/composition: %s",
    async (file) => {
      expect(
        (await messages('database.forModule("users");', file)).some(
          (message) => message.ruleId === "hambazi/database-ownership",
        ),
      ).toBe(true);
    },
  );
  it("does not query a delegate directly in a use case", async () => {
    expect(
      (await messages("db.user.findMany();", api("users"))).some(
        (message) => message.ruleId === "hambazi/database-ownership",
      ),
    ).toBe(true);
  });
  it("leaves owning database implementation internals available", async () => {
    expect(
      await messages("client.$transaction(run);", "packages/database/src/database.ts"),
    ).toEqual([]);
  });
  it("accepts existing composite unique selectors and JSON scalar values", async () => {
    expect(
      await messages(
        "db.processedCommand.findUnique({ where: { matchId_actionId: { matchId, actionId } } }); db.match.update({ where: { id }, data: { stateJsonb: state } });",
        repository("matches"),
      ),
    ).toEqual([]);
  });
});

describe("manifest architecture gate", () => {
  it("accepts the real repository manifests", () => expect(auditManifests(workspaces)).toEqual([]));
  it.each(["dependencies", "optionalDependencies", "peerDependencies"])(
    "checks forbidden runtime edges in %s",
    (section) => {
      const changed = structuredClone(workspaces);
      changed.find((workspace) => workspace.id === "coup-engine").manifest[section] = {
        "@prisma/client": "fixture",
      };
      expect(auditManifests(changed).join("\n")).toContain("Forbidden runtime dependency");
    },
  );
  it.each([
    ["shared", { dependencies: { "@hambazi/contracts": "workspace:*" } }, "Forbidden workspace"],
    ["web", { dependencies: { "@hambazi/database": "workspace:*" } }, "Forbidden workspace"],
    ["api", { dependencies: { "@hambazi/contracts": "0.0.0" } }, "workspace protocol"],
    ["api", { dependencies: { "@hambazi/unknown": "workspace:*" } }, "Unknown workspace"],
    ["api", { dependencies: { alias: "npm:@prisma/client@7.10.0" } }, "remapping"],
    ["api", { imports: { "#internal": "./src/users/repository.ts" } }, "remapping"],
    [
      "api",
      {
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./*": "./src/*",
        },
      },
      "wildcard",
    ],
    [
      "contracts",
      { exports: { ".": { types: "./dist/index.d.ts", import: "../database/dist/index.js" } } },
      "own compiled",
    ],
  ])("rejects manifest bypass for %s", (id, changes, expected) => {
    const changed = structuredClone(workspaces);
    Object.assign(changed.find((workspace) => workspace.id === id).manifest, changes);
    expect(auditManifests(changed).join("\n")).toContain(expected);
  });
  it("detects runtime workspace cycles", () => {
    const changed = structuredClone(workspaces);
    changed.find((workspace) => workspace.id === "shared").manifest.dependencies = {
      "@hambazi/contracts": "workspace:*",
    };
    expect(auditManifests(changed).join("\n")).toContain("Runtime workspace cycle");
  });
  it("rejects TypeScript resolver remapping instead of trusting an alias", () => {
    const temporary = mkdtempSync(resolve(tmpdir(), "hambazi-resolution-"));
    try {
      writeFileSync(
        resolve(temporary, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: { paths: { "@hambazi/contracts": ["packages/database/src/index.ts"] } },
        }),
      );
      expect(auditResolution(temporary).join("\n")).toContain(
        "paths requires a reviewed boundary resolver",
      );
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
    expect(auditResolution(root)).toEqual([]);
  });
});

import { existsSync, globSync, readFileSync, realpathSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, relative, resolve } from "node:path";

export const sourcePatterns = [
  "apps/*/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
  "packages/*/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
  "packages/games/*/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
];
export const apiDependencies = {
  auth: ["users"],
  users: [],
  games: [],
  rooms: ["users", "games"],
  matchmaking: ["users", "games", "matches"],
  matches: ["users", "rooms", "games"],
  realtime: ["auth", "users", "games", "rooms", "matchmaking", "matches", "presence", "chat"],
  presence: ["matches"],
  chat: ["matches"],
  leaderboard: [],
  admin: ["users", "games", "rooms", "matches"],
  health: [],
};
export const databaseOwners = ["users", "games", "rooms", "matches", "chat", "leaderboard"];
const common = ["shared", "contracts", "validation"];
const workspaceDependencies = {
  shared: [],
  contracts: ["shared"],
  validation: ["shared", "contracts"],
  config: ["shared"],
  database: ["shared", "config"],
  "game-core": common,
  api: [...common, "config", "database", "game-core"],
  web: common,
  bot: [...common, "config", "api"],
  worker: [...common, "config", "database", "api"],
};
export const posix = (path) => path.replaceAll("\\", "/");
export const packageName = (specifier) =>
  specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
export const isEngine = (workspace) => workspace.directory.startsWith("packages/games/");
export const isPure = (workspace) =>
  isEngine(workspace) || ["shared", "contracts", "game-core"].includes(workspace.id);
export const isTest = (file) =>
  /(?:^|\/)(?:tests?|__tests__|fixtures)(?:\/|$)|\.(?:test|spec)\.[^.]+$/.test(file);
export const isComposition = (file) =>
  file === "src/index.ts" || file.startsWith("src/composition/");
export const registeredWorkspace = (workspace) =>
  isEngine(workspace) ||
  workspace.directory.startsWith("tooling/") ||
  Object.hasOwn(workspaceDependencies, workspace.id);

export function readWorkspaces(root) {
  return globSync(
    [
      "apps/*/package.json",
      "packages/*/package.json",
      "packages/games/*/package.json",
      "tooling/*/package.json",
    ],
    { cwd: root },
  )
    .sort()
    .map((file) => {
      const manifest = JSON.parse(readFileSync(resolve(root, file), "utf8"));
      return {
        name: manifest.name,
        id: manifest.name.replace("@hambazi/", ""),
        directory: posix(dirname(file)),
        manifest,
      };
    });
}

export function workspaceEdgeAllowed(from, to) {
  if (from.directory.startsWith("tooling/")) return true;
  if (isEngine(from)) return [...common, "game-core"].includes(to.id);
  if (from.id === "api" && isEngine(to)) return true;
  return workspaceDependencies[from.id]?.includes(to.id) ?? false;
}

export function externalAllowed(workspace, dependency) {
  if (workspace.directory.startsWith("tooling/")) return true;
  if (isPure(workspace))
    return ["game-core"].includes(workspace.id) || isEngine(workspace)
      ? dependency === "zod"
      : false;
  if (
    /^(?:@prisma\/|prisma$|pg$|postgres$|postgresql$|mysql2$|knex$|typeorm$|sequelize$)/.test(
      dependency,
    )
  )
    return workspace.id === "database";
  if (workspace.id === "validation") return dependency === "zod";
  return true;
}

export function createPolicy(root, workspaces = readWorkspaces(root)) {
  root = resolve(root);
  const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const locate = (absolute) => {
    const file = posix(relative(root, absolute));
    const workspace = workspaces.find((candidate) => file.startsWith(`${candidate.directory}/`));
    return workspace ? { workspace, file: file.slice(workspace.directory.length + 1) } : undefined;
  };
  const moduleOf = (location) =>
    location.workspace.id === "api" && location.file.startsWith("src/")
      ? location.file.split("/")[1]
      : undefined;

  function checkImport(filename, specifier) {
    const from = locate(filename);
    if (!from || !from.file.startsWith("src/")) return;
    if (typeof specifier !== "string") return "Imports must use a static literal specifier.";
    const pure = isPure(from.workspace) || from.file.includes("/domain/");
    if (isBuiltin(specifier))
      return pure
        ? "Domain/engine code cannot import Node built-ins."
        : ["module", "node:module"].includes(specifier)
          ? "Runtime module loaders are not allowed in product source."
          : undefined;
    if (/[?#\\]/.test(specifier) || specifier.startsWith("/") || /^[a-z]+:/i.test(specifier))
      return "Aliases, URLs, query imports, and absolute imports require an explicit reviewed boundary mapping.";

    let to;
    let crossPackage = false;
    if (specifier.startsWith(".")) {
      let target = resolve(dirname(filename), specifier);
      // Resolve common emitted .js specifiers to their TypeScript source, including symlinks.
      const candidates = [
        target,
        target.replace(/\.js$/, ".ts"),
        target.replace(/\.js$/, ".tsx"),
        target.replace(/\.mjs$/, ".mts"),
        target.replace(/\.cjs$/, ".cts"),
      ];
      const existing = candidates.find((candidate) => existsSync(candidate));
      if (existing) target = realpathSync(existing);
      to = locate(target);
      if (!to) return "Source imports must stay inside a declared workspace.";
      if (to.workspace.name !== from.workspace.name)
        return "Cross-workspace imports must use a declared public package export, not a relative path.";
    } else {
      const name = packageName(specifier);
      const target = byName.get(name);
      const declared = {
        ...from.workspace.manifest.dependencies,
        ...from.workspace.manifest.peerDependencies,
        ...from.workspace.manifest.optionalDependencies,
      };
      if (!Object.hasOwn(declared, name))
        return "Production imports must declare their dependency (devDependencies do not qualify).";
      if (!target) {
        if (name.startsWith("@hambazi/")) return "Unknown workspace dependency.";
        if (!externalAllowed(from.workspace, name) || (pure && name !== "zod"))
          return "Infrastructure/framework dependency is forbidden in this owner.";
        return;
      }
      if (!workspaceEdgeAllowed(from.workspace, target))
        return "Workspace dependency direction is forbidden.";
      const subpath = specifier === name ? "." : `.${specifier.slice(name.length)}`;
      if (!Object.hasOwn(target.manifest.exports ?? {}, subpath))
        return "Import must use a documented explicit public package export.";
      // Current package roots and explicitly exported API module ports are the only product surfaces.
      if (
        subpath !== "." &&
        !(target.id === "api" && Object.hasOwn(apiDependencies, subpath.slice(2)))
      )
        return "Package internals are not public contracts.";
      to = {
        workspace: target,
        file: subpath === "." ? "src/index.ts" : `src/${subpath.slice(2)}/index.ts`,
      };
      crossPackage = true;
    }
    if (!to.file.startsWith("src/") || (!isTest(from.file) && isTest(to.file)))
      return "Production source cannot import tests, scripts, or compiled artifacts.";
    if (to.file.includes("/generated/") && from.workspace.id !== "database")
      return "Generated persistence models are private to database infrastructure.";
    if (to.workspace.id === "database" && crossPackage) {
      const owner = moduleOf(from);
      const repository =
        databaseOwners.includes(owner) &&
        from.file.startsWith(`src/${owner}/infrastructure/repositories/`);
      const composition = ["api", "worker"].includes(from.workspace.id) && isComposition(from.file);
      if (!repository && !composition)
        return "Database access belongs to owning API repository adapters or server composition roots.";
    }
    if (
      isEngine(to.workspace) &&
      crossPackage &&
      !(from.workspace.id === "api" && isComposition(from.file))
    )
      return "Concrete game engines are wired only by API composition; generic modules use game-core ports.";
    if (
      crossPackage &&
      pure &&
      !isPure(to.workspace) &&
      !["contracts", "shared", "validation"].includes(to.workspace.id)
    )
      return "Domain/engine code cannot depend on infrastructure.";
    if (from.workspace.id === "api" && to.workspace.id === "api") {
      if (from.file.includes("/domain/") && !to.file.includes("/domain/"))
        return "Domain code cannot depend on application or infrastructure layers.";
      const sourceModule = moduleOf(from);
      const targetModule = moduleOf(to);
      if (sourceModule !== targetModule || crossPackage) {
        if (
          !Object.hasOwn(apiDependencies, targetModule) ||
          (to.file !== `src/${targetModule}/index.ts` && to.file !== `src/${targetModule}/index.js`)
        )
          return "Cross-module imports must target the module index application port.";
        if (!isComposition(from.file) && !apiDependencies[sourceModule]?.includes(targetModule))
          return "API dependency matrix forbids this synchronous module edge.";
      }
      if (
        to.file.includes("/infrastructure/") &&
        (from.file.includes("/domain/") || from.file.includes("/application/"))
      )
        return "Application/domain code depends on repository interfaces, not infrastructure implementations.";
      if (
        /^src\/[^/]+\/index\.[^.]+$/.test(from.file) &&
        /\/(?:repositories|generated)\//.test(to.file)
      )
        return "Public ports cannot import or re-export repository/persistence implementations.";
    }
    if (to.workspace.id === "api" && from.workspace.id !== "api" && to.file === "src/index.ts")
      return "Bot/Worker must use an explicitly exported application module port, not API startup.";
    if (from.workspace.id === "web" && to.workspace.id === "web") {
      const owner = (file) => file.match(/^src\/(features\/[^/]+|games\/[^/]+)\//)?.[1];
      if (
        owner(from.file) !== owner(to.file) &&
        owner(to.file) &&
        !to.file.match(/^src\/(?:features|games)\/[^/]+\/index\.[jt]sx?$/)
      )
        return "Frontend feature/game internals must be accessed through their public index.";
    }
  }
  return { root, workspaces, locate, moduleOf, checkImport };
}

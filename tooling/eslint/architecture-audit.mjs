import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  apiDependencies,
  externalAllowed,
  registeredWorkspace,
  workspaceEdgeAllowed,
} from "./architecture-policy.mjs";

export function auditResolution(root) {
  const errors = [];
  for (const file of globSync(
    [
      "tsconfig*.json",
      "apps/*/tsconfig*.json",
      "packages/*/tsconfig*.json",
      "packages/games/*/tsconfig*.json",
      "tooling/typescript/*.json",
    ],
    { cwd: root },
  )) {
    const config = JSON.parse(readFileSync(resolve(root, file), "utf8"));
    for (const option of ["paths", "baseUrl", "rootDirs", "moduleSuffixes", "customConditions"]) {
      if (Object.hasOwn(config.compilerOptions ?? {}, option))
        errors.push(`${file}: ${option} requires a reviewed boundary resolver.`);
    }
  }
  return errors;
}

export function auditManifests(workspaces) {
  const errors = [];
  const names = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const edges = new Map();
  for (const workspace of workspaces) {
    const fail = (reason) => errors.push(`${workspace.directory}/package.json: ${reason}`);
    if (workspace.directory.startsWith("tooling/")) continue;
    if (!registeredWorkspace(workspace))
      fail("Unknown workspace owner; register its architecture policy.");
    if (
      workspace.manifest.imports ||
      workspace.manifest.browser ||
      workspace.manifest.typesVersions
    )
      fail("Import/browser/type remapping requires a reviewed boundary resolver.");
    const dependencies = {
      ...workspace.manifest.dependencies,
      ...workspace.manifest.peerDependencies,
      ...workspace.manifest.optionalDependencies,
    };
    edges.set(workspace.name, []);
    for (const [name, version] of Object.entries(dependencies)) {
      const target = names.get(name);
      if (target) {
        edges.get(workspace.name).push(name);
        if (!workspaceEdgeAllowed(workspace, target))
          fail(`Forbidden workspace dependency: ${name}.`);
        if (!version.startsWith("workspace:"))
          fail(`Local dependency ${name} must use the workspace protocol.`);
      } else {
        if (name.startsWith("@hambazi/")) fail(`Unknown workspace: ${name}.`);
        if (!externalAllowed(workspace, name)) fail(`Forbidden runtime dependency: ${name}.`);
        if (/^(?:npm:|file:|link:|https?:|git|patch:)/.test(version))
          fail(`Dependency remapping for ${name} requires review.`);
      }
    }
    const exports = workspace.manifest.exports;
    if (!exports || typeof exports !== "object" || !Object.hasOwn(exports, ".")) {
      fail("A product workspace must declare an explicit root export.");
      continue;
    }
    for (const [subpath, target] of Object.entries(exports)) {
      const module = subpath.slice(2);
      if (subpath !== "." && !(workspace.id === "api" && Object.hasOwn(apiDependencies, module))) {
        fail(`Internal or wildcard export is forbidden: ${subpath}.`);
        continue;
      }
      const stem = subpath === "." ? "./dist/index" : `./dist/${module}/index`;
      if (
        !target ||
        typeof target !== "object" ||
        target.types !== `${stem}.d.ts` ||
        target.import !== `${stem}.js` ||
        Object.keys(target).some((condition) => !["types", "import"].includes(condition))
      )
        fail(`Export ${subpath} must resolve only to its own compiled public index.`);
    }
  }
  const visited = new Set();
  function visit(name, path) {
    if (path.includes(name)) {
      errors.push(`Runtime workspace cycle: ${[...path, name].join(" -> ")}`);
      return;
    }
    if (visited.has(name)) return;
    visited.add(name);
    for (const dependency of edges.get(name) ?? []) visit(dependency, [...path, name]);
  }
  for (const name of edges.keys()) visit(name, []);
  return errors;
}

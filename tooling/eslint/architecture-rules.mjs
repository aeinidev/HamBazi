import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  apiDependencies,
  databaseOwners,
  isComposition,
  isPure,
  isTest,
} from "./architecture-policy.mjs";

const delegates = {
  auth: ["session", "botUpdateReceipt", "botOnboardingFlow"],
  users: ["user", "userSettings", "profileMutationReceipt"],
  games: ["game"],
  rooms: ["room", "roomMember", "roomCommandReceipt"],
  matches: [
    "matchAdmission",
    "matchReservation",
    "match",
    "matchPlayer",
    "matchConnectionLease",
    "gameEvent",
    "processedCommand",
    "gameResult",
    "outboxEvent",
  ],
  chat: ["chatMessage"],
  leaderboard: ["userGameStats", "consumerReceipt"],
};
const operations = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);
const literal = (node) => (node?.type === "Literal" ? node.value : undefined);
const key = (node) =>
  node?.computed
    ? literal(node.property ?? node.key)
    : ((node.property ?? node.key)?.name ?? literal(node.key));
const ambientReferences = (source) =>
  source.scopeManager.scopes
    .flatMap((scope) => scope.references)
    .filter((reference) => !reference.resolved || reference.resolved.defs.length === 0);

function scalarFields(root) {
  const schema = readFileSync(resolve(root, "packages/database/prisma/schema.prisma"), "utf8");
  const models = [...schema.matchAll(/^model (\w+) \{([^}]+)\}/gm)];
  const names = new Set(models.map((model) => model[1]));
  return new Map(
    models.map(([, name, body]) => {
      const scalar = new Set(
        [...body.matchAll(/^\s+(\w+)\s+(\w+)/gm)]
          .filter(([, , type]) => !names.has(type))
          .map(([, field]) => field),
      );
      for (const [, list] of body.matchAll(/@@(?:id|unique)\(\[([^\]]+)\]/g))
        scalar.add(
          list
            .split(",")
            .map((field) => field.trim())
            .join("_"),
        );
      return [name[0].toLowerCase() + name.slice(1), scalar];
    }),
  );
}

export function architecturePlugin(policy) {
  const fields = scalarFields(policy.root);
  return {
    rules: {
      boundaries: {
        meta: { type: "problem", schema: [], messages: { boundary: "{{reason}}" } },
        create(context) {
          const from = policy.locate(context.filename);
          if (!from || !from.file.startsWith("src/")) return {};
          const report = (node, reason) =>
            context.report({ node, messageId: "boundary", data: { reason } });
          const check = (node, source) => {
            const reason = policy.checkImport(context.filename, literal(source));
            if (reason) report(node, reason);
          };
          return {
            Program(node) {
              const owner = policy.moduleOf(from);
              if (
                from.workspace.id === "api" &&
                !isComposition(from.file) &&
                !Object.hasOwn(apiDependencies, owner)
              )
                report(
                  node,
                  "Unknown API module: register its ownership and dependency policy first.",
                );
            },
            ImportDeclaration: (node) => check(node, node.source),
            ExportNamedDeclaration: (node) => {
              if (node.source) check(node, node.source);
            },
            ExportAllDeclaration: (node) => check(node, node.source),
            ImportExpression: (node) => check(node, node.source),
            TSImportType: (node) => check(node, node.source ?? node.argument),
            TSImportEqualsDeclaration(node) {
              check(node, node.moduleReference.expression);
            },
            CallExpression(node) {
              if (node.callee.type === "Identifier" && node.callee.name === "require")
                check(node, node.arguments[0]);
            },
            "Program:exit"() {
              for (const reference of ambientReferences(context.sourceCode)) {
                const node = reference.identifier;
                if (
                  ["eval", "Function", "module"].includes(node.name) ||
                  (node.name === "require" &&
                    !(node.parent.type === "CallExpression" && node.parent.callee === node))
                )
                  report(node, "Runtime code/module loading must not bypass static import checks.");
              }
            },
          };
        },
      },
      "engine-determinism": {
        meta: {
          type: "problem",
          schema: [],
          messages: {
            dependency:
              "Inject Clock/RandomSource or an application adapter instead of ambient {{name}}.",
          },
        },
        create(context) {
          const from = policy.locate(context.filename);
          if (!from || !isPure(from.workspace) || isTest(from.file)) return {};
          const report = (node, name) =>
            context.report({ node, messageId: "dependency", data: { name } });
          // Unresolved global references also catch aliases/destructuring, not just direct calls.
          return {
            "Program:exit"() {
              const banned = new Set([
                "Date",
                "crypto",
                "performance",
                "process",
                "fetch",
                "WebSocket",
                "XMLHttpRequest",
                "setTimeout",
                "setInterval",
                "setImmediate",
                "queueMicrotask",
                "console",
                "globalThis",
                "global",
                "window",
                "document",
                "eval",
                "Function",
              ]);
              for (const reference of ambientReferences(context.sourceCode)) {
                const node = reference.identifier;
                if (banned.has(node.name)) report(node, node.name);
                if (node.name === "Math") {
                  const parent = node.parent;
                  if (
                    parent.type !== "MemberExpression" ||
                    parent.object !== node ||
                    !key(parent) ||
                    key(parent) === "random"
                  )
                    report(node, "Math.random");
                }
              }
            },
          };
        },
      },
      "database-ownership": {
        meta: { type: "problem", schema: [], messages: { ownership: "{{reason}}" } },
        create(context) {
          const from = policy.locate(context.filename);
          if (!from || !from.file.startsWith("src/") || from.workspace.id === "database") return {};
          const owner = policy.moduleOf(from);
          const repository =
            databaseOwners.includes(owner) &&
            from.file.startsWith(`src/${owner}/infrastructure/repositories/`);
          const report = (node, reason) =>
            context.report({ node, messageId: "ownership", data: { reason } });
          function queryShape(node, scalar, depth = 0) {
            if (!node) return;
            if (node.type === "ArrayExpression") {
              for (const element of node.elements) queryShape(element, scalar, depth);
              return;
            }
            if (node.type !== "ObjectExpression") {
              report(
                node,
                "Repository query structure must be inline object/array literals; pass dynamic values only at scalar fields.",
              );
              return;
            }
            for (const property of node.properties) {
              const name = key(property);
              if (property.type !== "Property" || property.computed || !name) {
                report(property, "Computed/spread query structure is not statically auditable.");
                continue;
              }
              if (depth > 0 && scalar.has(name)) continue;
              if (depth > 0 && name === "_count") {
                report(
                  property,
                  "Relation counts also cross ownership boundaries; use an application port.",
                );
                continue;
              }
              // Structural operations, not model relations. Unknown names fail closed.
              if (
                [
                  "where",
                  "select",
                  "omit",
                  "data",
                  "create",
                  "update",
                  "orderBy",
                  "cursor",
                  "having",
                  "AND",
                  "OR",
                  "NOT",
                  "_count",
                  "_sum",
                  "_avg",
                  "_min",
                  "_max",
                ].includes(name)
              ) {
                if (literal(property.value) !== true && literal(property.value) !== false)
                  queryShape(property.value, scalar, depth + 1);
              } else if (
                depth === 0 &&
                ["take", "skip", "distinct", "by", "skipDuplicates"].includes(name)
              ) {
                // Scalar query controls, not relation paths.
              } else
                report(
                  property,
                  "Relation traversal/nested writes are forbidden; query owned scalars or use another module's application port.",
                );
            }
          }
          return {
            MemberExpression(node) {
              const name = key(node);
              if (name === "forModule") {
                const call = node.parent;
                if (
                  !repository ||
                  call.type !== "CallExpression" ||
                  call.callee !== node ||
                  !(owner === "matches" ? ["matches", "outbox"] : [owner]).includes(
                    literal(call.arguments[0]),
                  ) ||
                  call.arguments.length !== 1
                )
                  report(
                    node,
                    "Only the owning repository may call forModule with its literal owner; aliases and dynamic owners are forbidden.",
                  );
              }
              if (
                [
                  "$queryRaw",
                  "$queryRawUnsafe",
                  "$executeRaw",
                  "$executeRawUnsafe",
                  "$extends",
                  "$transaction",
                ].includes(name)
              )
                report(
                  node,
                  "Raw Prisma/SQL escape hatches belong inside reviewed database infrastructure only.",
                );
            },
            Property(node) {
              if (node.parent.type === "ObjectPattern" && key(node) === "forModule")
                report(node, "Do not alias/destructure the database ownership selector.");
            },
            CallExpression(node) {
              if (node.callee.type !== "MemberExpression" || !operations.has(key(node.callee)))
                return;
              const delegate = node.callee.object;
              const name = delegate.type === "MemberExpression" ? key(delegate) : undefined;
              if (!repository) {
                if (Object.values(delegates).flat().includes(name))
                  report(
                    node,
                    "Prisma delegate operations belong only to owning repository adapters.",
                  );
                return;
              }
              if (!delegates[owner].includes(name)) {
                report(
                  node,
                  "Repository queries must directly name an owned delegate; foreign or aliased delegates are forbidden.",
                );
                return;
              }
              const scalar = fields.get(name);
              if (!scalar) {
                report(node, "Unknown persistence model; review the ownership policy.");
                return;
              }
              for (const argument of node.arguments) queryShape(argument, scalar);
            },
          };
        },
      },
    },
  };
}

import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { architecture } from "./architecture.mjs";
import { auditManifests, auditResolution } from "./architecture-audit.mjs";
import { readWorkspaces, sourcePatterns } from "./architecture-policy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const workspaces = readWorkspaces(root);
const errors = [...auditManifests(workspaces), ...auditResolution(root)];
// Independent uncached gate: root lint overrides and inline disable comments cannot
// silently remove architecture checks. The policy itself remains reviewed code.
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  allowInlineConfig: false,
  overrideConfig: [
    { ignores: ["**/dist/**", "**/node_modules/**", "packages/database/src/generated/**"] },
    architecture(root, workspaces),
  ],
});
const results = await eslint.lintFiles(sourcePatterns);
for (const error of errors) console.error(error);
const formatted = await (await eslint.loadFormatter("stylish")).format(results);
if (formatted) console.error(formatted);
if (errors.length || results.some((result) => result.errorCount || result.warningCount))
  process.exitCode = 1;
else
  console.log(
    `Architecture checks passed for ${workspaces.length} workspaces and ${results.length} source files.`,
  );

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { base, node, browser } from "../index.mjs";

function linter(runtime = []) {
  return new ESLint({ overrideConfigFile: true, overrideConfig: [...base, ...runtime] });
}

async function messages(source, filePath, runtime) {
  const [result] = await linter(runtime).lintText(source, { filePath });
  return result.messages;
}

describe("shared lint configuration", () => {
  it("accepts a typed public export", async () => {
    expect(await messages("export const value: number = 1;", "valid.ts")).toEqual([]);
  });

  it.each([
    ["export const value: any = 1;", "@typescript-eslint/no-explicit-any"],
    ["const unused = 1; export {};", "@typescript-eslint/no-unused-vars"],
    [
      'import { Item } from "./types.js"; export type Result = Item;',
      "@typescript-eslint/consistent-type-imports",
    ],
    ["export const same = (a: number, b: number) => a == b;", "eqeqeq"],
  ])("rejects invalid TypeScript: %s", async (source, rule) => {
    const result = await messages(source, "invalid.ts");
    expect(result.some((message) => message.ruleId === rule && message.severity === 2)).toBe(true);
    expect(result.some((message) => message.fatal)).toBe(false);
  });

  it("checks undefined JavaScript globals", async () => {
    expect(await messages("missing();", "invalid.mjs")).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleId: "no-undef" })]),
    );
  });

  it("enables Node globals only when requested", async () => {
    expect(await messages("export const pid = process.pid;", "node.mjs", [node])).toEqual([]);
    expect(await messages("export const pid = process.pid;", "pure.mjs")).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleId: "no-undef" })]),
    );
  });

  it("keeps browser and Node scopes separate", async () => {
    expect(await messages("document.title = 'HamBazi';", "web.mjs", [browser])).toEqual([]);
    expect(await messages("document.title = 'HamBazi';", "node.mjs", [node])).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleId: "no-undef" })]),
    );
  });

  it("reports stale disable comments", async () => {
    expect(
      await messages(
        "// eslint-disable-next-line no-debugger\nexport const value = 1;",
        "unused.mjs",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 2,
          message: expect.stringContaining("Unused eslint-disable"),
        }),
      ]),
    );
  });

  it.each(["dist/index.ts", "node_modules/dep/index.js", ".turbo/cache.js", "coverage/result.js"])(
    "ignores generated output %s",
    async (path) => {
      expect(await linter().isPathIgnored(path)).toBe(true);
    },
  );
});

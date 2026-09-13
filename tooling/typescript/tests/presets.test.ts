import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const compiler = join(dirname(require.resolve("typescript/package.json")), "bin/tsc");
const temporaryDirectories: string[] = [];

function write(root: string, file: string, content: unknown): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
}

function fixture(preset: string, source: string, options: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "hambazi-typescript-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, "node_modules/@hambazi"), { recursive: true });
  symlinkSync(packageRoot, join(root, "node_modules/@hambazi/typescript"), "junction");
  mkdirSync(join(root, "node_modules/@types"), { recursive: true });
  symlinkSync(
    dirname(require.resolve("@types/node/package.json")),
    join(root, "node_modules/@types/node"),
    "junction",
  );
  write(root, "package.json", { private: true, type: "module" });
  write(root, "tsconfig.json", {
    extends: `@hambazi/typescript/${preset}.json`,
    compilerOptions: { rootDir: "src", outDir: "dist", ...options },
    include: ["src/**/*.ts", "src/**/*.tsx"],
  });
  write(root, "src/index.ts", source);
  return root;
}

function tsc(
  root: string,
  args = ["--project", "tsconfig.json"],
): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [compiler, ...args, "--pretty", "false"], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

function expectSuccess(result: ReturnType<typeof tsc>): void {
  expect(result.output).toBe("");
  expect(result.status).toBe(0);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("public TypeScript presets", () => {
  it.each(["base", "library", "node", "web"])(
    "resolves %s through the package public surface",
    (preset) => {
      const root = fixture(preset, "export const value: number = 1;");
      const result = tsc(root, ["--project", "tsconfig.json", "--showConfig"]);
      expect(result.status).toBe(0);
      const config = JSON.parse(result.output) as {
        compilerOptions: { strict: boolean };
        files: string[];
      };
      expect(config.compilerOptions.strict).toBe(true);
      expect(config.files).toContain("./src/index.ts");
      expectSuccess(tsc(root));
    },
  );

  it.each([
    ["implicit any", "export function identity(value) { return value; }", 7006],
    ["null", "export const name: string = null;", 2322],
    ["unchecked indexing", "export const first: number = [1][0];", 2322],
    [
      "explicit undefined optional properties",
      "export const optional: { count?: number } = { count: undefined };",
      2375,
    ],
  ])("rejects %s and suppresses emit on error", (_name, source, code) => {
    const root = fixture("base", source);
    const result = tsc(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(`TS${code}`);
    expect(readdirSync(root)).not.toContain("dist");
  });

  it("excludes Node and browser globals from a pure library even when Node types are installed", () => {
    const root = fixture(
      "library",
      "export const pid = process.pid; export const title = document.title;",
    );
    const result = tsc(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("'process'");
    expect(result.output).toContain("'document'");
  });

  it("emits JavaScript, declarations, and maps from a pure library", () => {
    const root = fixture("library", "export const value: number = 1;");
    expectSuccess(tsc(root));
    expect(readdirSync(join(root, "dist"))).toEqual(
      expect.arrayContaining(["index.js", "index.js.map", "index.d.ts", "index.d.ts.map"]),
    );
    expect(readFileSync(join(root, "dist/index.d.ts"), "utf8")).toContain("value: number");
  });

  it("requires runtime-valid relative ESM extensions under NodeNext", () => {
    const root = fixture("library", 'export { value } from "./value";');
    write(root, "src/value.ts", "export const value = 1;");
    const result = tsc(root);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("TS2835");
    write(root, "src/index.ts", 'export { value } from "./value.js";');
    expectSuccess(tsc(root));
  });

  it("supports an artifact-free library check without making it a reference target", () => {
    const root = fixture("library", "export const value: number = 1;", {
      composite: false,
      incremental: false,
      noEmit: true,
    });
    expectSuccess(tsc(root));
    expect(readdirSync(root)).not.toContain("dist");
    expect(readdirSync(root).some((name) => name.endsWith(".tsbuildinfo"))).toBe(false);
  });

  it("typechecks Node APIs without emitting and rejects DOM globals", () => {
    const root = fixture(
      "node",
      'import { readFile } from "node:fs/promises"; export const content = readFile(process.argv[0] ?? "");',
    );
    expectSuccess(tsc(root));
    expect(readdirSync(root)).not.toContain("dist");
    write(root, "src/index.ts", "export const title = document.title;");
    expect(tsc(root).status).not.toBe(0);
  });

  it("typechecks DOM and bundler imports without emitting or admitting Node globals", () => {
    const root = fixture("web", 'import { value } from "./value"; document.title = value;');
    write(root, "src/value.ts", 'export const value = "HamBazi";');
    expectSuccess(tsc(root));
    expect(readdirSync(root)).not.toContain("dist");
    write(root, "src/index.ts", "export const pid = process.pid;");
    expect(tsc(root).status).not.toBe(0);
  });

  it("builds dependent composite projects and rejects an incompatible consumer", () => {
    const root = fixture("library", "export const unused = 0;");
    for (const project of ["producer", "consumer"]) {
      write(root, `${project}/tsconfig.json`, {
        extends: "@hambazi/typescript/library.json",
        compilerOptions: {
          rootDir: "src",
          outDir: "dist",
          tsBuildInfoFile: "dist/project.tsbuildinfo",
        },
        include: ["src/**/*.ts"],
        ...(project === "consumer" ? { references: [{ path: "../producer" }] } : {}),
      });
    }
    write(root, "producer/src/index.ts", "export const value: number = 1;");
    write(
      root,
      "consumer/src/index.ts",
      'import { value } from "../../producer/dist/index.js"; export const result: number = value;',
    );
    expectSuccess(tsc(root, ["--build", "consumer/tsconfig.json"]));
    expect(readFileSync(resolve(root, "consumer/dist/index.d.ts"), "utf8")).toContain(
      "result: number",
    );
    write(
      root,
      "consumer/src/index.ts",
      'import { value } from "../../producer/dist/index.js"; export const result: string = value;',
    );
    const result = tsc(root, ["--build", "consumer/tsconfig.json"]);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("TS2322");
  });
});

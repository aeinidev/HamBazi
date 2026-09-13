import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import pg from "pg";

let stage = "configuration";
try {
  const url = new URL(process.env.MIGRATION_DATABASE_URL ?? "");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    !url.hostname ||
    url.pathname === "/"
  )
    throw new Error();
  const require = createRequire(import.meta.url);
  // Capture CLI diagnostics: they can contain credentials, SQL, and rejected values.
  stage = "schema deploy";
  await promisify(execFile)(
    process.execPath,
    [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DEBUG: "", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  stage = "role grants";
  const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query(
      await readFile(new URL("../prisma/permissions.sql", import.meta.url), "utf8"),
    );
  } finally {
    await client.end();
  }
  console.info("Database migrations and role grants applied successfully.");
} catch (error) {
  const diagnostic =
    error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
  const codes = [
    ...new Set(diagnostic.match(/\bP\d{4}\b|\b(?:42501|23514|23505|23503|42601)\b/g) ?? []),
  ];
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^(?:ERR_[A-Z_]+|E[A-Z]+)$/.test(error.code)
  )
    codes.push(error.code);
  console.error(
    `DATABASE_MIGRATION_FAILED at ${stage}${codes.length ? ` (${codes.join(", ")})` : ""}: use a secure operator session for diagnosis.`,
  );
  process.exitCode = 1;
}

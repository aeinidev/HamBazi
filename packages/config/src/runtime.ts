import { URL } from "node:url";
import { z } from "zod";
import { SecretValue } from "./secret-value.js";

export type RuntimeRole = "api" | "worker";
type Field =
  | "ROLE"
  | "NODE_ENV"
  | "API_DATABASE_URL"
  | "WORKER_DATABASE_URL"
  | "API_REDIS_URL"
  | "WORKER_REDIS_URL"
  | "API_PORT"
  | "ALLOWED_ORIGINS";

export class ConfigurationError extends Error {
  readonly code = "INVALID_CONFIGURATION";
  readonly fields: readonly Field[];

  constructor(fields: readonly Field[]) {
    super("Runtime configuration is invalid");
    this.name = "ConfigurationError";
    this.fields = Object.freeze([...new Set(fields)]);
  }
}

type CommonConfig = Readonly<{
  environment: "development" | "test" | "production";
  databaseUrl: SecretValue;
  redisUrl: SecretValue;
}>;

export type RuntimeConfig = CommonConfig &
  (
    | Readonly<{ role: "api"; port: number; allowedOrigins: readonly string[] }>
    | Readonly<{ role: "worker" }>
  );

function connection(value: string, kind: "database" | "redis", production: boolean): boolean {
  try {
    if (value !== value.trim()) return false;
    const url = new URL(value);
    const protocols = kind === "database" ? ["postgres:", "postgresql:"] : ["redis:", "rediss:"];
    if (
      !protocols.includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      url.hash
    )
      return false;
    if (decodeURIComponent(url.password).startsWith("REPLACE_")) return false;
    if (kind === "database" && !/^\/[^/]+$/.test(url.pathname)) return false;
    if (kind === "redis" && url.pathname !== "" && !/^\/\d+$/.test(url.pathname)) return false;
    if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535))
      return false;
    if (production && kind === "redis" && url.protocol !== "rediss:") return false;
    if (
      production &&
      kind === "database" &&
      (url.searchParams.getAll("sslmode").length !== 1 ||
        !["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? ""))
    )
      return false;
    return true;
  } catch {
    return false;
  }
}

function origin(value: string, production: boolean): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      (!production || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !value.includes("*")
    );
  } catch {
    return false;
  }
}

// No process.env reads, file access, logging, or network I/O: the caller supplies input.
export function parseRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
  role: RuntimeRole,
): RuntimeConfig {
  if (role !== "api" && role !== "worker") throw new ConfigurationError(["ROLE"]);
  const databaseField = role === "api" ? "API_DATABASE_URL" : "WORKER_DATABASE_URL";
  const redisField = role === "api" ? "API_REDIS_URL" : "WORKER_REDIS_URL";
  const production = environment.NODE_ENV === "production";
  const shape = {
    NODE_ENV: z.enum(["development", "test", "production"]),
    [databaseField]: z.string().refine((value) => connection(value, "database", production)),
    [redisField]: z.string().refine((value) => connection(value, "redis", production)),
    ...(role === "api"
      ? {
          API_PORT: z
            .string()
            .regex(/^\d+$/)
            .transform(Number)
            .pipe(z.number().int().min(1).max(65535)),
          ALLOWED_ORIGINS: z
            .string()
            .transform((value) => value.split(",").map((item) => item.trim()))
            .pipe(z.array(z.string().refine((value) => origin(value, production))).min(1)),
        }
      : {}),
  };
  const result = z.object(shape).safeParse(environment);
  if (!result.success) {
    const allowed = new Set(Object.keys(shape));
    const fields = result.error.issues
      .map((issue) => String(issue.path[0]))
      .filter((field) => allowed.has(field)) as Field[];
    // Never attach the raw Zod error, rejected values, messages, or input object.
    throw new ConfigurationError(fields);
  }
  // Selected fields have been validated; no unknown environment variables are returned.
  const common = {
    environment: result.data.NODE_ENV,
    databaseUrl: new SecretValue(environment[databaseField]!),
    redisUrl: new SecretValue(environment[redisField]!),
  };
  if (role === "worker") return Object.freeze({ ...common, role });
  return Object.freeze({
    ...common,
    role,
    port: Number(environment.API_PORT),
    allowedOrigins: Object.freeze([
      ...new Set(
        environment.ALLOWED_ORIGINS!.split(",").map((value) => new URL(value.trim()).origin),
      ),
    ]),
  });
}

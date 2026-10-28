import { describe, it, expect } from "vitest";
import { parseAdminConfig } from "../src/admin.js";
const fixture = () => ({
  ADMIN_ENABLED: "true",
  ADMIN_REALM: "synthetic",
  ADMIN_ENVIRONMENT: "test",
  ADMIN_ORIGIN: "https://admin.local",
  ADMIN_BIND_ADDRESS: "127.0.0.1",
  ADMIN_PORT: "9443",
  ADMIN_PRIVATE_PEERS: "127.0.0.1",
  ADMIN_DATABASE_URL: "postgresql://hambazi_admin_runtime:synthetic@127.0.0.1/test",
  ADMIN_READ_DATABASE_URL: "postgresql://hambazi_admin_reader:synthetic@127.0.0.1/test",
  ADMIN_DB_POOL_MAX: "2",
  ADMIN_SESSION_SECONDS: "900",
  ADMIN_IDLE_SECONDS: "300",
  ADMIN_PENDING_SECONDS: "120",
  ADMIN_SIGNING_KEY: Buffer.alloc(32, 11).toString("base64url"),
  ADMIN_PIN_PEPPER: Buffer.alloc(32, 22).toString("base64url"),
  ADMIN_COMMAND_KEY: Buffer.alloc(32, 33).toString("base64url"),
  ADMIN_ISSUER: "urn:synthetic:admin",
  ADMIN_AUDIENCE: "urn:synthetic:dashboard",
  ADMIN_ARGON_MEMORY_KIB: "19456",
  ADMIN_ARGON_TIME: "2",
  ADMIN_CRYPTO_CONCURRENCY: "2",
  ADMIN_MAX_IN_FLIGHT: "4",
  ADMIN_TLS_KEY_FILE: "/private/key.pem",
  ADMIN_TLS_CERT_FILE: "/private/cert.pem",
  ADMIN_RATE_LIMIT: "30",
  ADMIN_REDIS_URL: "redis://:synthetic@127.0.0.1:6379/0",
});
describe("explicit local Admin configuration", () => {
  it("keeps restrictions closed unless mutations and explicit phase-three activation are both configured", () => {
    expect(parseAdminConfig(fixture())!.restrictionsEnabled).toBe(false);
    expect(() =>
      parseAdminConfig({ ...fixture(), ADMIN_USER_RESTRICTIONS_ENABLED: "true" }),
    ).toThrow("ADMIN_CONFIGURATION_INVALID");
    const config = parseAdminConfig({
      ...fixture(),
      ADMIN_MUTATIONS_ENABLED: "true",
      ADMIN_USER_RESTRICTIONS_ENABLED: "true",
      ADMIN_OPERATIONS_DATABASE_URL:
        "postgresql://hambazi_admin_operations:synthetic@127.0.0.1/test",
    });
    expect(config!.restrictionsEnabled).toBe(true);
  });
  it("keeps mutations disabled and requires the distinct operations role on the same primary database", () => {
    expect(parseAdminConfig(fixture())!.operationsDatabaseUrl).toBeUndefined();
    const url = "postgresql://hambazi_admin_operations:synthetic@127.0.0.1/test";
    for (const patch of [
      { ADMIN_MUTATIONS_ENABLED: "true" },
      { ADMIN_OPERATIONS_DATABASE_URL: url },
      {
        ADMIN_MUTATIONS_ENABLED: "true",
        ADMIN_OPERATIONS_DATABASE_URL: url.replace("hambazi_admin_operations", "hambazi_api"),
      },
      {
        ADMIN_MUTATIONS_ENABLED: "true",
        ADMIN_OPERATIONS_DATABASE_URL: url.replace("/test", "/another_environment"),
      },
    ])
      expect(() => parseAdminConfig({ ...fixture(), ...patch })).toThrow(
        "ADMIN_CONFIGURATION_INVALID",
      );
    const config = parseAdminConfig({
      ...fixture(),
      ADMIN_MUTATIONS_ENABLED: "true",
      ADMIN_OPERATIONS_DATABASE_URL: url,
    })!;
    expect(config.operationsDatabaseUrl!.reveal()).toBe(url);
    expect(JSON.stringify(config)).not.toContain("synthetic@127");
  });
  it("requires an explicit, private, distinct trusted reverse proxy for public ingress", () => {
    const base = {
      ...fixture(),
      ADMIN_PRIVATE_PEERS: "127.0.0.1,127.0.0.2",
      ADMIN_INGRESS_MODE: "public-proxy",
    };
    for (const ADMIN_PROXY_PEERS of [
      undefined,
      "",
      "8.8.8.8",
      "127.0.0.1",
      "127.0.0.3",
      "127.0.0.2,127.0.0.2",
    ])
      expect(() =>
        parseAdminConfig({
          ...base,
          ...(ADMIN_PROXY_PEERS === undefined ? {} : { ADMIN_PROXY_PEERS }),
        }),
      ).toThrow();
    expect(parseAdminConfig({ ...base, ADMIN_PROXY_PEERS: "127.0.0.2" })!.proxyPeers).toEqual([
      "127.0.0.2",
    ]);
    expect(() => parseAdminConfig({ ...fixture(), ADMIN_PROXY_PEERS: "127.0.0.2" })).toThrow();
    expect(parseAdminConfig(fixture())!.ingressMode).toBe("private");
  });
  it("is disabled unless explicitly enabled and has no production defaults", () => {
    expect(parseAdminConfig({})).toBeNull();
    expect(parseAdminConfig({ ADMIN_ENABLED: "false" })).toBeNull();
    expect(() => parseAdminConfig({ ADMIN_ENABLED: "true" })).toThrow();
    const config = parseAdminConfig(fixture())!;
    expect(config.pendingSeconds).toBe(120);
    expect(JSON.stringify(config)).not.toContain("synthetic@127");
  });
  it("rejects public bind/peers, weak or reused keys, ambiguous origins and unbounded resource settings", () => {
    for (const patch of [
      { ADMIN_BIND_ADDRESS: "0.0.0.0" },
      { ADMIN_PRIVATE_PEERS: "8.8.8.8" },
      { ADMIN_ORIGIN: "https://admin.local/path" },
      { ADMIN_CRYPTO_CONCURRENCY: "100" },
      { ADMIN_DB_POOL_MAX: "100" },
      { ADMIN_ARGON_MEMORY_KIB: "1024" },
      { ADMIN_PENDING_SECONDS: "86400" },
      { ADMIN_IDLE_SECONDS: "901" },
      { ADMIN_PIN_PEPPER: fixture().ADMIN_SIGNING_KEY },
      { ADMIN_SIGNING_KEY: "weak" },
      { AUTH_SIGNING_KEYS: JSON.stringify({ active: fixture().ADMIN_SIGNING_KEY }) },
    ])
      expect(() => parseAdminConfig({ ...fixture(), ...patch })).toThrow();
  });
  it("requires verified PostgreSQL and Redis TLS in production", () => {
    expect(() => parseAdminConfig({ ...fixture(), NODE_ENV: "production" })).toThrow();
    const f = fixture();
    expect(
      parseAdminConfig({
        ...f,
        NODE_ENV: "production",
        ADMIN_DATABASE_URL: f.ADMIN_DATABASE_URL + "?sslmode=verify-full",
        ADMIN_READ_DATABASE_URL: f.ADMIN_READ_DATABASE_URL + "?sslmode=verify-full",
        ADMIN_REDIS_URL: f.ADMIN_REDIS_URL.replace("redis:", "rediss:"),
      }),
    ).not.toBeNull();
  });
});

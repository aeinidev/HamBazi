import { randomBytes } from "node:crypto";
import { buildIdentity } from "../../release/build.mjs";
import { createBrowserPolicy } from "../../../apps/web/security/browser-policy.ts";
import { telegramSdkIntegrity } from "../../../apps/web/src/platform/telegram-sdk.ts";

// Synthetic configuration only; no endpoint or credential belongs to staging.
export function deploymentFixture() {
  const secret = () => randomBytes(32).toString("base64url");
  const token = `123456789:${secret()}`,
    webhook = secret(),
    signing = secret(),
    service = secret();
  const inputs = {
    privateAddresses: {
      api: "10.99.0.10",
      bot: "10.99.0.11",
      worker: "10.99.0.12",
      web: "10.99.0.13",
    },
    stopGraceSeconds: { api: 40, bot: 40, worker: 40, web: 10 },
  };
  const envs = {
    api: {
      NODE_ENV: "production",
      API_PORT: "8080",
      API_BIND_ADDRESS: "0.0.0.0",
      API_HEALTH_PORT: "8081",
      API_DATABASE_URL: `postgresql://hambazi_api:${secret()}@db.private:5432/hambazi?sslmode=verify-full`,
      API_REDIS_URL: `rediss://api:${secret()}@redis.private:6379/0`,
      ALLOWED_ORIGINS: "https://mini.example",
      API_DB_POOL_MAX: "5",
      API_TRUSTED_PROXIES: "",
      PROFILE_READ_LIMIT: "60",
      PROFILE_WRITE_LIMIT: "10",
      CATALOG_READ_LIMIT: "60",
      TELEGRAM_BOT_TOKEN: token,
      AUTH_SESSION_SECONDS: "900",
      AUTH_TELEGRAM_MAX_AGE_SECONDS: "300",
      AUTH_TELEGRAM_FUTURE_SKEW_SECONDS: "30",
      AUTH_IP_LIMIT: "30",
      AUTH_IDENTITY_LIMIT: "6",
      AUTH_ACTIVE_KEY_ID: "fixture",
      AUTH_ISSUER: "hambazi:deployment",
      AUTH_AUDIENCE: "fixture",
      AUTH_SIGNING_KEYS: JSON.stringify([{ id: "fixture", secret: signing }]),
      BOT_INTERNAL_ENABLED: "true",
      BOT_INTERNAL_BIND_ADDRESS: inputs.privateAddresses.api,
      BOT_INTERNAL_PORT: "9443",
      BOT_INTERNAL_TLS_KEY_FILE: "/run/hambazi/tls/key.pem",
      BOT_INTERNAL_TLS_CERT_FILE: "/run/hambazi/tls/cert.pem",
      BOT_INTERNAL_REQUEST_LIMIT: "100",
      BOT_INTERNAL_IDENTITY_LIMIT: "20",
      BOT_ONBOARDING_LEASE_MS: "15000",
      BOT_SERVICE_ACTIVE_KEY_ID: "fixture",
      BOT_SERVICE_KEYS: JSON.stringify([{ id: "fixture", secret: service }]),
      BOT_SERVICE_ALLOWED_PEERS: inputs.privateAddresses.bot,
      TELEGRAM_WEBHOOK_SECRET: webhook,
      ...Object.fromEntries(
        [
          "HTTP_PER_MINUTE",
          "ENGINE_PER_MINUTE",
          "CONNECT_PER_MINUTE",
          "EVENT_PER_MINUTE",
          "HTTP_IN_FLIGHT",
          "ENGINE_IN_FLIGHT",
          "CONNECTIONS",
          "PENDING_PER_SOCKET",
          "PENDING_TOTAL",
          "SUBSCRIPTIONS",
        ].map((key) => [`ADMISSION_${key}`, "10"]),
      ),
    },
    bot: {
      NODE_ENV: "production",
      TELEGRAM_BOT_TOKEN: token,
      TELEGRAM_BOT_USERNAME: "HamBaziFixtureBot",
      TELEGRAM_WEBHOOK_SECRET: webhook,
      BOT_SERVICE_KEY_ID: "fixture",
      BOT_SERVICE_KEY: service,
      BOT_API_ORIGIN: "https://10.99.0.10:9443",
      BOT_API_CA_FILE: "/run/hambazi/tls/api-ca.pem",
      BOT_BIND_ADDRESS: inputs.privateAddresses.bot,
      BOT_PORT: "9444",
      BOT_HEALTH_PORT: "8081",
      BOT_TLS_KEY_FILE: "/run/hambazi/tls/key.pem",
      BOT_TLS_CERT_FILE: "/run/hambazi/tls/cert.pem",
      BOT_MINI_APP_URL: "https://mini.example",
      BOT_BACKEND_TIMEOUT_MS: "1000",
      BOT_SEND_TIMEOUT_MS: "1000",
      BOT_ONBOARDING_LEASE_MS: "15000",
      BOT_MAX_IN_FLIGHT: "10",
    },
    worker: {
      NODE_ENV: "production",
      WORKER_DATABASE_URL: `postgresql://hambazi_worker:${secret()}@db.private:5432/hambazi?sslmode=verify-full`,
      WORKER_REDIS_URL: `rediss://worker:${secret()}@redis.private:6379/0`,
      WORKER_QUEUE_NAMESPACE: "fixture",
      WORKER_DB_POOL_MAX: "3",
      WORKER_HEALTH_PORT: "8081",
      BOT_CLEANUP_INTERVAL_MS: "1000",
      BOT_CLEANUP_BATCH_SIZE: "10",
      BOT_CLEANUP_ATTEMPTS: "3",
      BOT_CLEANUP_BACKOFF_MS: "100",
    },
    web: {
      NODE_ENV: "production",
      WEB_BIND_ADDRESS: "0.0.0.0",
      WEB_PORT: "8080",
      WEB_HEALTH_PORT: "8081",
    },
  };
  const policy = createBrowserPolicy(
    { profile: "production", webOrigin: null, apiOrigin: null, frameAncestors: [] },
    telegramSdkIntegrity,
  );
  const manifest = {
    schemaVersion: 1,
    purpose: "local-packaging-candidate",
    productionReleaseApproved: false,
    platform: "linux/amd64",
    sourceCommit: "a".repeat(40),
    sourceDirty: false,
    sourceSnapshotSha256: "b".repeat(64),
    browserPolicy: policy,
  };
  manifest.buildInputSha256 = buildIdentity(manifest.sourceSnapshotSha256, policy);
  manifest.images = ["api", "bot", "worker", "web"].map((role, index) => ({
    role,
    image: `hambazi-candidate/${role}:${manifest.sourceCommit}-${manifest.buildInputSha256.slice(0, 16)}@sha256:${String(index + 1).repeat(64)}`,
  }));
  const report = {
    ...manifest,
    kind: "application-images",
    status: "passed",
    ok: true,
    database: { updatedAt: new Date().toISOString(), downloadedAt: new Date().toISOString() },
    images: manifest.images.map((entry) => ({
      ...entry,
      counts: { critical: 0, high: 0, moderate: 0, low: 0, info: 0, unknown: 0 },
      findings: [],
    })),
  };
  return { envs, inputs, manifest, report };
}

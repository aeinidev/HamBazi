import { expect, it } from "vitest";
import { parseOutboxWorkerConfig } from "../src/index.js";
const env = {
  MATCH_OUTBOX_ENABLED: "true",
  MATCH_OUTBOX_INTERVAL_MS: "1000",
  MATCH_OUTBOX_BATCH_SIZE: "10",
  MATCH_OUTBOX_LEASE_MS: "10000",
  MATCH_OUTBOX_ATTEMPTS: "3",
  MATCH_OUTBOX_BACKOFF_MS: "100",
  MATCH_OUTBOX_MAX_BACKOFF_MS: "1000",
  MATCH_OUTBOX_PUBLISH_TIMEOUT_MS: "2000",
};
it("disables outbox by omission and requires a complete explicit policy when enabled", () => {
  expect(parseOutboxWorkerConfig({})).toBeUndefined();
  expect(parseOutboxWorkerConfig({ MATCH_OUTBOX_ENABLED: "false" })).toBeUndefined();
  expect(parseOutboxWorkerConfig({ ...env, MATCH_OUTBOX_ENABLED: "false" })).toBeUndefined();
  expect(parseOutboxWorkerConfig(env)).toMatchObject({ batchSize: 10, policy: { maxAttempts: 3 } });
  for (const key of Object.keys(env)) {
    const incomplete = { ...env };
    delete incomplete[key as keyof typeof env];
    expect(() => parseOutboxWorkerConfig(incomplete)).toThrow();
  }
});
it.each([
  { MATCH_OUTBOX_LEASE_MS: "1000" },
  { MATCH_OUTBOX_BATCH_SIZE: "0" },
  { MATCH_OUTBOX_ATTEMPTS: "99" },
  { MATCH_OUTBOX_MAX_BACKOFF_MS: "50" },
])("rejects unsafe or partial configuration %#", (patch) => {
  expect(() => parseOutboxWorkerConfig({ ...env, ...patch })).toThrow(
    /^Invalid outbox worker configuration$/,
  );
});

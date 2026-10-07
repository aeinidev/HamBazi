import { expect, it, vi } from "vitest";
import { admissionPolicy } from "../fixtures/admission.js";
const client = vi.hoisted(() => ({
  isReady: true,
  on: vi.fn(),
  eval: vi.fn(),
  withAbortSignal: vi.fn(),
}));
vi.mock("redis", () => ({ createClient: () => client }));
import { createRedisTransportAdmission } from "../../src/realtime/index.js";

it.each([
  [[1, 0], { allowed: true }],
  [[0, 0], { allowed: false, reason: "limited", retryAfterSeconds: 1 }],
  [[0, 1], { allowed: false, reason: "limited", retryAfterSeconds: 1 }],
  [[0, 1001], { allowed: false, reason: "limited", retryAfterSeconds: 2 }],
  [[-1, 0], { allowed: false, reason: "unavailable" }],
  [[1, -1], { allowed: false, reason: "unavailable" }],
  [[0, -2], { allowed: false, reason: "unavailable" }],
  [[1, 60001], { allowed: false, reason: "unavailable" }],
  [[1, 0.5], { allowed: false, reason: "unavailable" }],
  [[1, "0"], { allowed: false, reason: "unavailable" }],
])("interprets a bounded Redis decision %j without relaxing admission", async (reply, expected) => {
  client.withAbortSignal.mockReturnValue(client);
  client.eval.mockResolvedValue(reply);
  const admission = createRedisTransportAdmission({
    url: { reveal: () => "redis://127.0.0.1:1" },
    namespace: "rate-response",
    policy: admissionPolicy,
  });
  expect(await admission.rate("11111111-1111-4111-8111-111111111111", "event")).toEqual(expected);
});

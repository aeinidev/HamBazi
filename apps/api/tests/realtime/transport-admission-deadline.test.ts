import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createRedisTransportAdmission } from "../../src/realtime/index.js";
import { admissionPolicy } from "../fixtures/admission.js";

const redis = vi.hoisted(() => ({ eval: vi.fn(), destroy: vi.fn() }));
vi.mock("redis", () => ({
  createClient: () => ({
    isReady: true,
    isOpen: true,
    on() {},
    withAbortSignal: () => ({ eval: redis.eval }),
    destroy: redis.destroy,
  }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it.each(["http", "engine", "connect", "event"] as const)(
  "bounds an already-written %s command and never grants its late Redis reply",
  async (operation) => {
    vi.useFakeTimers();
    let settle!: (result: number[]) => void;
    redis.eval.mockReturnValue(new Promise<number[]>((resolve) => (settle = resolve)));
    const adapter = createRedisTransportAdmission({
      url: { reveal: () => "redis://127.0.0.1:1" },
      namespace: "deadline-regression",
      policy: admissionPolicy,
    });
    try {
      const pending =
        operation === "http" || operation === "engine"
          ? adapter.ip("127.0.0.1", operation)
          : adapter.rate(randomUUID(), operation);
      let returned = false;
      void pending.then(() => (returned = true));
      await vi.advanceTimersByTimeAsync(999);
      expect(returned).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ allowed: false, reason: "unavailable" });
      settle([1, 60000]);
      await Promise.resolve();
      expect(await pending).toEqual({ allowed: false, reason: "unavailable" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      adapter.close();
    }
  },
);

it("preserves valid replies and limited windows within the existing deadline", async () => {
  redis.eval.mockResolvedValueOnce([1, 60000]).mockResolvedValueOnce([0, 1234]);
  const adapter = createRedisTransportAdmission({
    url: { reveal: () => "redis://127.0.0.1:1" },
    namespace: "deadline-regression",
    policy: admissionPolicy,
  });
  try {
    expect(await adapter.ip("127.0.0.1", "http")).toEqual({ allowed: true });
    expect(await adapter.ip("127.0.0.1", "http")).toEqual({
      allowed: false,
      reason: "limited",
      retryAfterSeconds: 2,
    });
  } finally {
    adapter.close();
  }
});

import { describe, expect, it, vi } from "vitest";
import { UnrecoverableError } from "bullmq";
import { cleanupProcessor } from "../../src/onboarding-cleanup.js";
const job = { name: "bot-onboarding-cleanup-v1", data: { schemaVersion: 1, limit: 10 } };
describe("versioned cleanup jobs", () => {
  it("invokes the public port with only a bounded versioned request", async () => {
    const cleanup = vi.fn(async () => ({
      ok: true,
      receipts: 10,
      flows: 0,
      extra: "never returned",
    }));
    expect(await cleanupProcessor(cleanup)(job)).toEqual({
      schemaVersion: 1,
      receipts: 10,
      flows: 0,
    });
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(job.data);
  });
  it.each([
    { schemaVersion: 2, limit: 10 },
    { schemaVersion: 1, limit: 0 },
    { schemaVersion: 1, limit: 501 },
    { schemaVersion: 1, limit: 10, senderId: "secret" },
    null,
  ])("permanently rejects invalid data %#", async (data) => {
    const cleanup = vi.fn();
    await expect(cleanupProcessor(cleanup)({ ...job, data })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(cleanup).not.toHaveBeenCalled();
  });
  it("does not accept an unknown job version/name", async () => {
    await expect(cleanupProcessor(vi.fn())({ ...job, name: "v2" })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
  it.each([
    { ok: false },
    { ok: true, status: "RETRY" },
    { ok: true, receipts: -1, flows: 0 },
    { ok: true, receipts: 11, flows: 0 },
    { ok: true, receipts: 1.5, flows: 0 },
  ])("makes unsuccessful or invalid results retryable %#", async (result) => {
    await expect(cleanupProcessor(async () => result)(job)).rejects.toThrow(
      "Onboarding cleanup failed",
    );
  });
  it("never persists raw dependency errors in BullMQ failedReason", async () => {
    await expect(
      cleanupProcessor(async () => {
        throw new Error("sensitive database value");
      })(job),
    ).rejects.toThrow(/^Onboarding cleanup failed$/);
  });
});

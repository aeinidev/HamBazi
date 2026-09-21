import { describe, it, expect } from "vitest";
import { createDeliveryHandler } from "../../src/delivery.js";
import { RetryDelivery } from "../../src/backend.js";
import { fixture, raw, delivery } from "./fixtures.js";
describe("commit/send/ack orchestration", () => {
  it("only acknowledges after a successful send", async () => {
    const f = fixture();
    await createDeliveryHandler(f)(raw(), AbortSignal.timeout(1000));
    expect(f.backend.process).toHaveBeenCalledOnce();
    expect(f.sender.send).toHaveBeenCalledOnce();
    expect(f.backend.acknowledge).toHaveBeenCalledWith(
      { schemaVersion: 1, receiptId: delivery.receiptId, version: 1, messageId: 900 },
      expect.any(AbortSignal),
    );
    expect(f.backend.process.mock.invocationCallOrder[0]!).toBeLessThan(
      f.sender.send.mock.invocationCallOrder[0]!,
    );
    expect(f.sender.send.mock.invocationCallOrder[0]!).toBeLessThan(
      f.backend.acknowledge.mock.invocationCallOrder[0]!,
    );
  });
  it.each(["DONE", "EXPIRED"] as const)("does not resend %s", async (status) => {
    const f = fixture();
    f.backend.process.mockResolvedValue({ schemaVersion: 1, ok: true, status });
    await createDeliveryHandler(f)(raw(), AbortSignal.timeout(1000));
    expect(f.sender.send).not.toHaveBeenCalled();
    expect(f.backend.acknowledge).not.toHaveBeenCalled();
  });
  it.each(["process", "send", "ack"] as const)("keeps %s failures retryable", async (stage) => {
    const f = fixture();
    if (stage === "process") f.backend.process.mockRejectedValue(new RetryDelivery());
    if (stage === "send") f.sender.send.mockRejectedValue(new RetryDelivery());
    if (stage === "ack") f.backend.acknowledge.mockRejectedValue(new RetryDelivery());
    await expect(createDeliveryHandler(f)(raw(), AbortSignal.timeout(1000))).rejects.toThrow();
    if (stage === "send") expect(f.backend.acknowledge).not.toHaveBeenCalled();
  });
  it("checks response correlation before sending", async () => {
    const f = fixture();
    f.backend.process.mockResolvedValue({
      schemaVersion: 1,
      ok: true,
      status: "REPLY",
      delivery: { ...delivery, chatId: "101" },
    });
    await expect(createDeliveryHandler(f)(raw(), AbortSignal.timeout(1000))).rejects.toThrow();
    expect(f.sender.send).not.toHaveBeenCalled();
  });
  it("does not acknowledge after an aborted ambiguous send", async () => {
    const f = fixture();
    const c = new AbortController();
    f.sender.send.mockImplementation(async () => {
      c.abort();
      return 900;
    });
    await expect(createDeliveryHandler(f)(raw(), c.signal)).rejects.toThrow();
    expect(f.backend.acknowledge).not.toHaveBeenCalled();
  });
  it("ignores unsupported events without effects", async () => {
    const f = fixture();
    await createDeliveryHandler(f)({ update_id: 1, edited_message: {} }, AbortSignal.timeout(1000));
    expect(f.backend.process).not.toHaveBeenCalled();
  });
});

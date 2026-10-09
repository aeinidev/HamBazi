import { describe, it, expect, vi } from "vitest";
import { createDeliveryHandler } from "../../src/delivery.js";
import { RetryDelivery } from "../../src/backend.js";
import { fixture, raw, delivery } from "./fixtures.js";
import { SupportDeliveryError } from "../../src/telegram.js";
describe("commit/send/ack orchestration", () => {
  it.each(["DELIVERED", "FAILED", "UNKNOWN"] as const)(
    "persists %s before same-request user confirmation",
    async (outcome) => {
      const f = fixture();
      const sendSupport = vi.fn(async () => {
        if (outcome !== "DELIVERED") throw new SupportDeliveryError(outcome);
        return 901;
      });
      const support = {
        ...delivery,
        data: { submissionId: delivery.receiptId },
        reply: "SUPPORT_DISPATCH" as const,
        submissionId: delivery.receiptId,
        attemptVersion: 1,
        adminChatId: "100",
        text: "Submitted text",
      };
      const confirmation = {
        ...delivery,
        version: 2,
        reply:
          outcome === "DELIVERED"
            ? ("SUPPORT_SENT" as const)
            : outcome === "FAILED"
              ? ("SUPPORT_FAILED" as const)
              : ("SUPPORT_UNKNOWN" as const),
      };
      f.backend.process
        .mockResolvedValueOnce({
          ok: true,
          schemaVersion: 1,
          status: "SUPPORT",
          delivery: support,
        })
        .mockResolvedValueOnce({
          ok: true,
          schemaVersion: 1,
          status: "REPLY",
          delivery: confirmation,
        });
      const ownerAdmission = {
        telegramId: async () => "100",
        admittedTelegramIds: async () => ["100"],
        allowsTelegramId: async () => true,
        allowsUserId: async () => true,
      };
      await expect(
        createDeliveryHandler({ ...f, sender: { ...f.sender, sendSupport }, ownerAdmission })(
          raw(),
          AbortSignal.timeout(1000),
        ),
      ).resolves.toBeUndefined();
      expect(f.sender.send).toHaveBeenCalledWith(confirmation, expect.any(AbortSignal));
      expect(f.backend.process).toHaveBeenCalledTimes(2);
      expect(f.backend.process.mock.calls[0]![0]).toEqual(f.backend.process.mock.calls[1]![0]);
      expect(f.backend.acknowledge.mock.invocationCallOrder[0]!).toBeLessThan(
        f.sender.send.mock.invocationCallOrder[0]!,
      );
      expect(sendSupport).toHaveBeenCalledOnce();
      expect(f.backend.acknowledge).toHaveBeenCalledWith(
        {
          schemaVersion: 1,
          kind: "SUPPORT",
          submissionId: support.submissionId,
          attemptVersion: 1,
          receiptClaim: { receiptId: support.receiptId, version: support.version },
          outcome,
          ...(outcome === "DELIVERED" ? { messageId: 901 } : {}),
        },
        expect.any(AbortSignal),
      );
    },
  );
  it.each(["ack", "resume", "support-again"] as const)(
    "does not blindly resend support when %s fails",
    async (failure) => {
      const f = fixture();
      const support = {
        ...delivery,
        reply: "SUPPORT_DISPATCH" as const,
        submissionId: delivery.receiptId,
        attemptVersion: 1,
        adminChatId: "100",
        text: "private",
        data: { submissionId: delivery.receiptId },
      };
      f.backend.process.mockResolvedValue({
        ok: true,
        schemaVersion: 1,
        status: "SUPPORT",
        delivery: support,
      });
      if (failure === "ack") f.backend.acknowledge.mockRejectedValueOnce(new RetryDelivery());
      if (failure === "resume")
        f.backend.process
          .mockResolvedValueOnce({
            ok: true,
            schemaVersion: 1,
            status: "SUPPORT",
            delivery: support,
          })
          .mockRejectedValueOnce(new RetryDelivery());
      const sendSupport = vi.fn(async () => 901);
      const ownerAdmission = {
        telegramId: async () => "100",
        admittedTelegramIds: async () => ["100"],
        allowsTelegramId: async () => true,
        allowsUserId: async () => true,
      };
      await expect(
        createDeliveryHandler({ ...f, sender: { ...f.sender, sendSupport }, ownerAdmission })(
          raw(),
          AbortSignal.timeout(1000),
        ),
      ).rejects.toThrow(RetryDelivery);
      expect(sendSupport).toHaveBeenCalledOnce();
      expect(f.sender.send).not.toHaveBeenCalled();
    },
  );
  it("denies non-owner original senders before backend and Telegram effects", async () => {
    const f = fixture();
    const ownerAdmission = {
      telegramId: async () => "101",
      admittedTelegramIds: async () => ["101"],
      allowsTelegramId: vi.fn(async () => false),
      allowsUserId: async () => false,
    };
    await createDeliveryHandler({ ...f, ownerAdmission })(raw(), AbortSignal.timeout(1000));
    expect(f.backend.process).not.toHaveBeenCalled();
    expect(f.sender.send).not.toHaveBeenCalled();
    expect(f.backend.acknowledge).not.toHaveBeenCalled();
  });
  it("rechecks revoked admission before Telegram delivery", async () => {
    const f = fixture();
    const ownerAdmission = {
      telegramId: async () => "100",
      admittedTelegramIds: async () => ["100"],
      allowsTelegramId: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      allowsUserId: async () => false,
    };
    await createDeliveryHandler({ ...f, ownerAdmission })(raw(), AbortSignal.timeout(1000));
    expect(f.backend.process).toHaveBeenCalledOnce();
    expect(f.sender.send).not.toHaveBeenCalled();
    expect(f.backend.acknowledge).not.toHaveBeenCalled();
  });
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

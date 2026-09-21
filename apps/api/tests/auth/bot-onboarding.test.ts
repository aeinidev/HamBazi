import { describe, expect, it, vi } from "vitest";
import { botOnboardingService } from "../../src/auth/application/bot-onboarding.js";
import {
  FLOW_LIFETIME_MS,
  RECEIPT_LIFETIME_MS,
} from "../../src/auth/application/bot-onboarding-ports.js";
import { botFixture, botContext, update, acknowledge } from "./bot-onboarding-fixtures.js";

describe("durable Bot onboarding application", () => {
  it("runs start/create/prompt/name/menu without minting a session", async () => {
    const f = botFixture();
    const start = await f.service.process(botContext, update("START"));
    expect(start).toMatchObject({
      status: "REPLY",
      delivery: { reply: "CREATE_ACCOUNT", chatId: "100" },
    });
    await acknowledge(f.service, start);
    expect(f.flows.size).toBe(0);
    const create = await f.service.process(botContext, update("CREATE", 2));
    await acknowledge(f.service, create);
    const name = await f.service.process(botContext, update("NAME", 3));
    expect(name).toMatchObject({ status: "REPLY", delivery: { reply: "MENU" } });
    expect(f.create).toHaveBeenCalledExactlyOnceWith("100", "  Mehdi ");
    expect(f.flows.size).toBe(0);
    await acknowledge(f.service, name, 901);
    expect(await f.service.process(botContext, update("NAME", 3))).toMatchObject({
      status: "DONE",
    });
    expect(f.rows.size).toBe(0);
    expect(JSON.stringify([...f.receipts.values()])).not.toContain("Mehdi");
  });
  it.each([
    { schemaVersion: 2 },
    { senderId: "0" },
    { senderId: "not-an-id" },
    { senderId: "" },
    { chatId: "not-an-id" },
    { senderId: "9007199254740992" },
    { chatId: "101" },
    { chatType: "group" },
    { updateId: -1 },
    { updateId: 2147483648 },
    { messageId: 0 },
    { unknown: "payload" },
    { action: "EDITED_NAME" },
    { displayName: "unsolicited" },
  ])("rejects invalid operation %# before storage", async (patch) => {
    const f = botFixture();
    expect(await f.service.process(botContext, { ...update("START"), ...patch })).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(f.receipts.size).toBe(0);
  });
  it("rejects wrong service scope before storage", async () => {
    const f = botFixture();
    expect(
      await f.service.process({ ...botContext, scope: "admin" } as never, update("CREATE")),
    ).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    expect(f.receipts.size).toBe(0);
  });
  it.each(["not-a-bot", "", "9223372036854775808"])(
    "rejects malformed bot identity without exposing a parse exception: %s",
    async (botId) => {
      const f = botFixture();
      expect(await f.service.process({ ...botContext, botId }, update("CREATE"))).toMatchObject({
        ok: false,
        error: { code: "UNAUTHENTICATED" },
      });
      expect(f.receipts.size).toBe(0);
    },
  );
  it("does not create accounts for unsolicited, unacknowledged or wrong-prompt names", async () => {
    const f = botFixture();
    expect(await f.service.process(botContext, update("NAME"))).toMatchObject({
      delivery: { reply: "EXPIRED" },
    });
    const create = await f.service.process(botContext, update("CREATE", 2));
    expect(await f.service.process(botContext, update("NAME", 3))).toMatchObject({
      delivery: { reply: "EXPIRED" },
    });
    await acknowledge(f.service, create, 901);
    expect(await f.service.process(botContext, update("NAME", 4))).toMatchObject({
      delivery: { reply: "EXPIRED" },
    });
    expect(f.create).not.toHaveBeenCalled();
  });
  it("re-prompts invalid names with new correlation and unchanged lifetime", async () => {
    const f = botFixture();
    await acknowledge(f.service, await f.service.process(botContext, update("CREATE")));
    const expires = [...f.flows.values()][0]!.expiresAt;
    const invalid = await f.service.process(botContext, {
      ...update("NAME", 2),
      displayName: "\u202e",
    });
    expect(invalid).toMatchObject({ delivery: { reply: "INVALID_NAME" } });
    expect([...f.flows.values()][0]!.expiresAt).toBe(expires);
    await acknowledge(f.service, invalid, 901);
    expect(await f.service.process(botContext, update("NAME", 3))).toMatchObject({
      delivery: { reply: "EXPIRED" },
    });
    expect(
      await f.service.process(botContext, { ...update("NAME", 4), replyToMessageId: 901 }),
    ).toMatchObject({ delivery: { reply: "MENU" } });
  });
  it("recovers pending replies after a lease without extending either retention", async () => {
    const f = botFixture();
    const first = await f.service.process(botContext, update("CREATE"));
    expect(await f.service.process(botContext, update("CREATE"))).toMatchObject({
      status: "RETRY",
    });
    const before = [...f.receipts.values()][0]!;
    const flow = [...f.flows.values()][0]!;
    f.clock.value += 5000;
    const resumed = await botOnboardingService(f.deps).process(botContext, update("CREATE"));
    expect(resumed).toMatchObject({ delivery: { reply: "PROMPT_NAME", version: 2 } });
    expect(await acknowledge(f.service, first)).toMatchObject({ status: "RETRY" });
    expect(await acknowledge(f.service, resumed)).toMatchObject({ status: "DONE" });
    expect(await acknowledge(f.service, resumed)).toMatchObject({ status: "DONE" });
    expect([...f.receipts.values()][0]!.expiresAt).toBe(before.expiresAt);
    expect([...f.flows.values()][0]!.expiresAt).toBe(flow.expiresAt);
  });
  it("keeps stale prompt acknowledgements from overwriting a newer prompt", async () => {
    const f = botFixture();
    const first = await f.service.process(botContext, update("CREATE"));
    const next = await f.service.process(botContext, update("START", 2));
    await acknowledge(f.service, next, 901);
    await acknowledge(f.service, first, 900);
    expect([...f.flows.values()][0]!.promptMessageId).toBe(901);
  });
  it("cancel invalidates the prompt and a later Create starts a distinct flow", async () => {
    const f = botFixture();
    await acknowledge(f.service, await f.service.process(botContext, update("CREATE")));
    const id = [...f.flows.values()][0]!.id;
    expect(await f.service.process(botContext, update("CANCEL", 2))).toMatchObject({
      delivery: { reply: "CANCELLED" },
    });
    expect(await f.service.process(botContext, update("NAME", 3))).toMatchObject({
      delivery: { reply: "EXPIRED" },
    });
    await f.service.process(botContext, update("CREATE", 4));
    expect([...f.flows.values()][0]!.id).not.toBe(id);
  });
  it("expires a conversation at its exact deadline and requires explicit restart", async () => {
    const f = botFixture();
    await acknowledge(f.service, await f.service.process(botContext, update("CREATE")));
    f.clock.value += FLOW_LIFETIME_MS;
    expect(await f.service.process(botContext, update("NAME", 2))).toMatchObject({
      delivery: { reply: "EXPIRED" },
    });
    expect(await f.service.process(botContext, update("START", 3))).toMatchObject({
      delivery: { reply: "CREATE_ACCOUNT" },
    });
    expect(f.create).not.toHaveBeenCalled();
  });
  it("refuses expired receipts immediately and bounds idempotent cleanup", async () => {
    const f = botFixture();
    await f.service.process(botContext, update("CREATE"));
    await f.service.process(botContext, update("START", 2, "101"));
    f.clock.value += RECEIPT_LIFETIME_MS;
    expect(await f.service.process(botContext, update("CREATE"))).toMatchObject({
      status: "EXPIRED",
    });
    expect(await f.service.cleanup({ schemaVersion: 1, limit: 1 })).toEqual({
      ok: true,
      schemaVersion: 1,
      receipts: 1,
      flows: 1,
    });
    expect(await f.service.cleanup({ schemaVersion: 1, limit: 1 })).toMatchObject({
      receipts: 1,
      flows: 0,
    });
    expect(await f.service.cleanup({ schemaVersion: 1, limit: 1 })).toMatchObject({
      receipts: 0,
      flows: 0,
    });
  });
  it("resolves an existing active account without creating a flow or changing its name", async () => {
    const f = botFixture();
    expect(await f.service.process(botContext, update("CREATE", 1, "42"))).toMatchObject({
      delivery: { reply: "MENU" },
    });
    expect(f.create).not.toHaveBeenCalled();
    expect(f.flows.size).toBe(0);
  });
  it("denies blocked accounts without reactivating them", async () => {
    const f = botFixture();
    f.accountsByTelegram.set(42n, { ...f.accountsByTelegram.get(42n)!, status: "BLOCKED" });
    await acknowledge(f.service, await f.service.process(botContext, update("CREATE", 1, "42")));
    expect(await f.service.process(botContext, update("NAME", 2, "42"))).toMatchObject({
      delivery: { reply: "DENIED" },
    });
    expect(f.accountsByTelegram.get(42n)!.status).toBe("BLOCKED");
  });
  it("returns retry without leaking dependency failures", async () => {
    const f = botFixture();
    vi.spyOn(f.repository, "claim").mockRejectedValue(new Error("sensitive raw payload"));
    const result = await f.service.process(botContext, update("CREATE"));
    expect(result).toEqual({ ok: true, schemaVersion: 1, status: "RETRY" });
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
  it.each([0, 501, -1, 1.5])("rejects unsafe cleanup limit %s", async (limit) => {
    expect(await botFixture().service.cleanup({ schemaVersion: 1, limit })).toMatchObject({
      ok: false,
    });
  });
  it.each([0, 999, 60001, NaN])("rejects invalid lease duration %s", (leaseMs) => {
    expect(() => botOnboardingService({ ...botFixture().deps, leaseMs })).toThrow(
      "Invalid onboarding lease configuration",
    );
  });
});

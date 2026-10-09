import { expect, it, vi } from "vitest";
import { createStagingTestIdentityObserver } from "../../src/staging-test-identity.js";

function fixture() {
  let now = 1700000000000;
  const writeOnce = vi.fn(async () => {});
  const observe = createStagingTestIdentityObserver({
    username: "devtest98",
    botId: "123",
    botUsername: "test_bot",
    now: () => now,
    writeOnce,
  });
  const raw = {
    update_id: 10,
    message: {
      message_id: 20,
      date: now / 1000,
      text: "/start",
      from: { id: 43, is_bot: false, username: "DevTest98" },
      chat: { id: 43, type: "private" },
    },
  };
  return {
    writeOnce,
    observe,
    raw,
    later(ms: number) {
      now += ms;
    },
  };
}
it("extracts only minimal identity from an original private start; grants no account or admission", async () => {
  const f = fixture();
  await f.observe(f.raw);
  expect(f.writeOnce).toHaveBeenCalledWith({
    schemaVersion: 1,
    purpose: "verified-private-telegram-start",
    telegramUserId: "43",
    observedUsername: "DevTest98",
    botId: "123",
    updateId: 10,
    messageId: 20,
    receivedAt: "2023-11-14T22:13:20.000Z",
  });
});
it.each([
  (r: ReturnType<typeof fixture>["raw"]) => ({ ...r, edited_message: r.message }),
  (r: ReturnType<typeof fixture>["raw"]) => ({
    ...r,
    message: { ...r.message, forward_origin: {} },
  }),
  (r: ReturnType<typeof fixture>["raw"]) => ({ ...r, message: { ...r.message, via_bot: {} } }),
  (r: ReturnType<typeof fixture>["raw"]) => ({
    ...r,
    message: { ...r.message, business_connection_id: "x" },
  }),
  (r: ReturnType<typeof fixture>["raw"]) => ({ ...r, message: { ...r.message, text: "profile" } }),
  (r: ReturnType<typeof fixture>["raw"]) => ({
    ...r,
    message: { ...r.message, date: r.message.date - 100 },
  }),
  (r: ReturnType<typeof fixture>["raw"]) => ({
    ...r,
    message: { ...r.message, date: r.message.date + 100 },
  }),
  (r: ReturnType<typeof fixture>["raw"]) => ({
    ...r,
    message: { ...r.message, chat: { id: 44, type: "private" } },
  }),
  (r: ReturnType<typeof fixture>["raw"]) => ({
    ...r,
    message: { ...r.message, chat: { id: 43, type: "group" } },
  }),
  (r: ReturnType<typeof fixture>["raw"]) => ({
    ...r,
    message: { ...r.message, from: { ...r.message.from, username: "unrelated" } },
  }),
  (r: ReturnType<typeof fixture>["raw"]) => ({
    ...r,
    message: { ...r.message, from: { ...r.message.from, is_bot: true } },
  }),
])("ignores ineligible or stale identity inputs (%#)", async (change) => {
  const f = fixture();
  await f.observe(change(f.raw));
  expect(f.writeOnce).not.toHaveBeenCalled();
});
it("expires the observation window", async () => {
  const f = fixture();
  f.later(30 * 60 * 1000 + 1);
  await f.observe(f.raw);
  expect(f.writeOnce).not.toHaveBeenCalled();
});

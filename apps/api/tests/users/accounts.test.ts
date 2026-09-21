import { describe, expect, it, vi } from "vitest";
import { createErrorEnvelope } from "@hambazi/contracts";
import { normalizeDisplayName, handleBase } from "../../src/users/domain/account-name.js";
import {
  accountCreationService,
  type AccountCandidate,
  type AccountRecord,
} from "../../src/users/application/accounts.js";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const record: AccountRecord = {
  userId: id,
  displayName: "Original",
  publicHandle: "original_65022",
  status: "ACTIVE",
};
function fixture() {
  const repository = {
    findByTelegramId: vi.fn(async (): Promise<AccountRecord | undefined> => undefined),
    createOrGet: vi.fn(async (candidate: AccountCandidate): Promise<AccountRecord | undefined> => ({
      ...candidate,
      status: "ACTIVE",
    })),
  };
  const newUserId = vi.fn(() => id);
  const newHandleSuffix = vi.fn(() => 65022);
  return {
    repository,
    newUserId,
    newHandleSuffix,
    port: accountCreationService({ repository, newUserId, newHandleSuffix }),
  };
}
describe("display-name policy", () => {
  it.each([
    ["  Mehdi   Silva  ", "Mehdi Silva"],
    ["Jose\u0301", "José"],
    ["مهدی نیم\u200cفاصله", "مهدی نیم\u200cفاصله"],
    ["علي", "علي"],
    ["李明", "李明"],
    ["👩‍👩‍👧‍👦", "👩‍👩‍👧‍👦"],
    ["⭐️", "⭐️"],
    ["a".repeat(40), "a".repeat(40)],
    ["😀".repeat(40), "😀".repeat(40)],
    ["e\u0301".repeat(40), "é".repeat(40)],
    ["<b>Name</b>", "<b>Name</b>"],
    ["A\u00a0B", "A\u00a0B"],
  ])("normalizes accepted text %#", (input, expected) => {
    expect(normalizeDisplayName(input)).toBe(expected);
    expect(normalizeDisplayName(expected)).toBe(expected);
  });
  it.each([
    undefined,
    null,
    42,
    {},
    "",
    "   ",
    "\u00a0",
    "\u200c\u200d",
    "\u0301",
    "a".repeat(41),
    "😀".repeat(41),
    " ".repeat(256) + "a",
    "\ud800",
    "\udc00",
    "x\ud800y",
    "a\nb",
    "a\rb",
    "a\tb",
    "a\0b",
    "a\u007fb",
    "a\u0085b",
    "a\u2028b",
    "a\u2029b",
    "a\u202eb",
    "a\u2066b",
    "a\u2069b",
    "a\u200fb",
    "a\u061cb",
    "a\ufeffb",
    "a\u200bb",
  ])("rejects unsafe or empty text %#", (input) => {
    expect(normalizeDisplayName(input)).toBeUndefined();
  });
  it.each([
    ["Mehdi", "mehdi"],
    ["José Silva", "jose_silva"],
    ["Ａｌｉ", "ali"],
    ["__A--B__", "a_b"],
    ["A".repeat(30), "a".repeat(20)],
    ["A".repeat(19) + " B", "a".repeat(19)],
    ["مهدی", "user"],
    ["😀", "user"],
    ["Mehdi李", "user"],
    ["123", "user"],
    ["---", "user"],
    ["<b>Name</b>", "user"],
  ])("derives a bounded safe base %#", (name, expected) => {
    expect(handleBase(name)).toBe(expected);
    expect(handleBase(name)).toMatch(/^[a-z][a-z0-9_]{0,19}$/);
  });
});
describe("account creation application port", () => {
  it("normalizes name and generates separate UUID and numeric handle without leaking repository fields", async () => {
    const f = fixture();
    expect(
      await f.port.createForVerifiedTelegramIdentity("9223372036854775807", " Mehdi "),
    ).toEqual({
      ok: true,
      account: { schemaVersion: 1, userId: id, displayName: "Mehdi", publicHandle: "mehdi_65022" },
    });
    expect(f.repository.createOrGet).toHaveBeenCalledWith({
      userId: id,
      telegramUserId: 9223372036854775807n,
      displayName: "Mehdi",
      publicHandle: "mehdi_65022",
    });
  });
  it("returns an existing account unchanged without generating candidates", async () => {
    const f = fixture();
    f.repository.findByTelegramId.mockResolvedValue(record);
    expect(await f.port.createForVerifiedTelegramIdentity("42", "Different")).toEqual({
      ok: true,
      account: {
        schemaVersion: 1,
        userId: id,
        displayName: record.displayName,
        publicHandle: record.publicHandle,
      },
    });
    expect(f.newUserId).not.toHaveBeenCalled();
    expect(f.newHandleSuffix).not.toHaveBeenCalled();
    expect(f.repository.createOrGet).not.toHaveBeenCalled();
  });
  it.each(["BLOCKED", "DELETED", "UNKNOWN", "active", ""])(
    "denies existing %s before or during the creation race",
    async (status) => {
      const f = fixture();
      f.repository.findByTelegramId.mockResolvedValue({ ...record, status });
      expect(await f.port.createForVerifiedTelegramIdentity("42", "Mehdi")).toEqual(
        createErrorEnvelope("UNAUTHENTICATED"),
      );
      expect(f.repository.createOrGet).not.toHaveBeenCalled();
      f.repository.findByTelegramId.mockResolvedValue(undefined);
      f.repository.createOrGet.mockResolvedValue({ ...record, status });
      expect(await f.port.createForVerifiedTelegramIdentity("42", "Mehdi")).toEqual(
        createErrorEnvelope("UNAUTHENTICATED"),
      );
    },
  );
  it.each(["", "0", "-1", "01", "1.0", "1e3", "9223372036854775808", "9".repeat(100)])(
    "rejects invalid identity %# without IO",
    async (value) => {
      const f = fixture();
      expect(await f.port.createForVerifiedTelegramIdentity(value, "Mehdi")).toEqual(
        createErrorEnvelope("INVALID_INPUT"),
      );
      expect(f.repository.findByTelegramId).not.toHaveBeenCalled();
    },
  );
  it("validates names even on repeats before IO", async () => {
    const f = fixture();
    expect(await f.port.createForVerifiedTelegramIdentity("42", "\n")).toEqual(
      createErrorEnvelope("INVALID_INPUT"),
    );
    expect(f.repository.findByTelegramId).not.toHaveBeenCalled();
  });
  it("retries with fresh candidates and can succeed on attempt five", async () => {
    const f = fixture();
    let suffix = 65021;
    f.newHandleSuffix.mockImplementation(() => ++suffix);
    for (let i = 0; i < 4; i++) f.repository.createOrGet.mockResolvedValueOnce(undefined);
    const result = await f.port.createForVerifiedTelegramIdentity("42", "مهدی");
    expect(result.ok && result.account.publicHandle).toBe("user_65026");
    expect(f.newUserId).toHaveBeenCalledTimes(5);
    expect(f.newHandleSuffix).toHaveBeenCalledTimes(5);
  });
  it("bounds collisions to five attempts", async () => {
    const f = fixture();
    f.repository.createOrGet.mockResolvedValue(undefined);
    expect(await f.port.createForVerifiedTelegramIdentity("42", "Mehdi")).toEqual(
      createErrorEnvelope("INTERNAL_ERROR"),
    );
    expect(f.repository.createOrGet).toHaveBeenCalledTimes(5);
  });
  it.each([9999, 100000, 65022.5, NaN, Infinity])(
    "denies invalid server suffix %#",
    async (suffix) => {
      const f = fixture();
      f.newHandleSuffix.mockReturnValue(suffix);
      expect(await f.port.createForVerifiedTelegramIdentity("42", "Mehdi")).toEqual(
        createErrorEnvelope("INTERNAL_ERROR"),
      );
      expect(f.repository.createOrGet).not.toHaveBeenCalled();
    },
  );
  it("denies invalid UUIDs and suppresses entropy/repository errors", async () => {
    const f = fixture();
    f.newUserId.mockReturnValue("42");
    expect(await f.port.createForVerifiedTelegramIdentity("42", "Mehdi")).toEqual(
      createErrorEnvelope("INTERNAL_ERROR"),
    );
    f.newUserId.mockImplementation(() => {
      throw new Error("sensitive entropy diagnostic");
    });
    expect(await f.port.createForVerifiedTelegramIdentity("42", "Mehdi")).toEqual(
      createErrorEnvelope("INTERNAL_ERROR"),
    );
    f.repository.findByTelegramId.mockRejectedValue(new Error("sensitive database diagnostic"));
    expect(await f.port.createForVerifiedTelegramIdentity("42", "Mehdi")).toEqual(
      createErrorEnvelope("INTERNAL_ERROR"),
    );
  });
});

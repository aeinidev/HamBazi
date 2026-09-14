import { describe, expect, it, vi } from "vitest";
import { identityService } from "../../src/users/application/identity.js";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
describe("Users authentication eligibility", () => {
  it.each(["BLOCKED", "DELETED", "UNKNOWN", "active", ""])(
    "denies non-ACTIVE status %s",
    async (status) => {
      const find = async () => ({ userId: id, status });
      const port = identityService({ findById: find, findByTelegramId: find });
      expect(await port.findActiveById(id)).toBeUndefined();
      expect(await port.findActiveByTelegramId("42")).toBeUndefined();
    },
  );
  it("projects only an internal identity and normalizes UUID lookup", async () => {
    const find = vi.fn(async () => ({ userId: id, status: "ACTIVE", profile: "private" }));
    const port = identityService({ findById: find, findByTelegramId: find });
    expect(await port.findActiveById(id.toUpperCase())).toEqual({ userId: id });
    expect(find).toHaveBeenCalledWith(id);
    expect(await port.findActiveByTelegramId("9007199254740993")).toEqual({ userId: id });
    expect(find).toHaveBeenCalledWith(9007199254740993n);
  });
  it.each(["", "0", "-1", "01", "1.5", "9223372036854775808", "NaN"])(
    "rejects invalid Telegram identity %s without repository access",
    async (value) => {
      const find = vi.fn();
      const port = identityService({ findById: find, findByTelegramId: find });
      expect(await port.findActiveByTelegramId(value)).toBeUndefined();
      expect(find).not.toHaveBeenCalled();
    },
  );
  it("returns no identity for unknown users or malformed UUIDs", async () => {
    const find = vi.fn(async () => undefined);
    const port = identityService({ findById: find, findByTelegramId: find });
    expect(await port.findActiveById("bad")).toBeUndefined();
    expect(find).not.toHaveBeenCalled();
    expect(await port.findActiveById(id)).toBeUndefined();
  });
});

import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { profileService, type ProfileRepository } from "../../src/users/application/profile.js";
const userId = randomUUID();
const commandId = randomUUID();
function fixture() {
  const repository: ProfileRepository = {
    read: vi.fn(),
    patch: vi.fn(async (_id, input) => ({
      ok: true as const,
      commandId: input.commandId,
      appliedVersion: input.expectedVersion + 1,
    })),
    cleanup: vi.fn(),
    usernameAvailable: vi.fn(async () => true),
  };
  return { repository, service: profileService(repository) };
}
const input = (patch: unknown) => ({ schemaVersion: 1, commandId, expectedVersion: 0, patch });
describe("profile intent", () => {
  it.each([
    {},
    { settings: {} },
    { displayName: "\u202Eevil" },
    { displayName: " " },
    { displayName: "x".repeat(257) },
    { publicHandle: "changed" },
    { userId },
    { settings: { locale: "xx" } },
    { settings: { theme: "unknown" } },
    { settings: { sound: true } },
    { displayName: null },
  ])("rejects invalid patch %j", async (patch) => {
    const f = fixture();
    expect(await f.service.patch(userId, input(patch))).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(f.repository.patch).not.toHaveBeenCalled();
  });
  it("normalizes names and command UUID before persistence", async () => {
    const f = fixture();
    await f.service.patch(userId.toUpperCase(), {
      ...input({ displayName: "  Jose\u0301   Silva  ", settings: { theme: "dark" } }),
      commandId: commandId.toUpperCase(),
    });
    expect(f.repository.patch).toHaveBeenCalledWith(userId, {
      ...input({ displayName: "José Silva", settings: { theme: "dark" } }),
    });
  });
  it("accepts a normalized username and an official avatar", async () => {
    const f = fixture();
    expect(
      await f.service.patch(userId, input({ username: "New_Player", avatar: "hb-01" })),
    ).toMatchObject({ ok: true });
    expect(f.repository.patch).toHaveBeenCalledWith(
      userId,
      input({ username: "new_player", avatar: "hb-01" }),
    );
  });
  it.each(["ab", "a b", "نام", "name@", "x".repeat(33)])(
    "rejects invalid username %s",
    async (username) => {
      const f = fixture();
      expect(await f.service.patch(userId, input({ username }))).toMatchObject({
        error: { code: "INVALID_INPUT" },
      });
    },
  );
  it.each([
    "https://evil.example/a.jpg",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "hb-11",
    "data:image/jpeg;base64," + "A".repeat(250000),
  ])("rejects unsafe avatars", async (avatar) => {
    const f = fixture();
    expect(await f.service.patch(userId, input({ avatar }))).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });
  it("checks usernames using verified identity, normalization and safe errors", async () => {
    const f = fixture();
    expect(await f.service.checkUsername(userId, "Free_Name")).toEqual({
      ok: true,
      available: true,
    });
    expect(f.repository.usernameAvailable).toHaveBeenCalledWith(userId, "free_name");
    expect(await f.service.checkUsername("bad", "free_name")).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(await f.service.checkUsername(userId, "bad name")).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    vi.mocked(f.repository.usernameAvailable).mockRejectedValue(new Error("private data"));
    expect(await f.service.checkUsername(userId, "free_name")).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
  });
  it.each([-1, 2147483647, 1.5, "0"])("rejects invalid revision %s", async (expectedVersion) => {
    const f = fixture();
    expect(
      await f.service.patch(userId, { ...input({ displayName: "Mehdi" }), expectedVersion }),
    ).toMatchObject({ error: { code: "INVALID_INPUT" } });
  });
  it("sanitizes dependency failures", async () => {
    const f = fixture();
    vi.mocked(f.repository.patch).mockRejectedValue(new Error("private payload"));
    expect(
      JSON.stringify(await f.service.patch(userId, input({ displayName: "Mehdi" }))),
    ).not.toContain("private");
    vi.mocked(f.repository.read).mockRejectedValue(new Error("secret"));
    expect(await f.service.read(userId)).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });
  it("denies malformed identity before repository access", async () => {
    const f = fixture();
    expect(await f.service.read("42")).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    expect(f.repository.read).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createErrorEnvelope } from "@hambazi/contracts";
import { createMiniAppOnboarding } from "../../src/auth/index.js";
import { onboardingFixture } from "./onboarding-fixtures.js";
import { initData, commandId, now, userId } from "./session-fixtures.js";

describe("Mini App account onboarding application boundary", () => {
  it("creates only the verified Telegram identity and projects no persistence/session fields", async () => {
    const f = onboardingFixture();
    const result = await f.onboarding.create(initData(99), commandId, "  مهدی  ");
    expect(result).toMatchObject({
      ok: true,
      account: { schemaVersion: 1, displayName: "مهدی", publicHandle: "user_65022" },
    });
    expect(f.create).toHaveBeenCalledWith("99", "  مهدی  ");
    expect(f.accountsByTelegram.size).toBe(3);
    expect(f.rows.size).toBe(0);
    expect(Object.keys(result).sort()).toEqual(["account", "ok"]);
    if (!result.ok) throw new Error("Synthetic onboarding failed");
    expect(Object.keys(result.account).sort()).toEqual([
      "displayName",
      "publicHandle",
      "schemaVersion",
      "userId",
    ]);
  });
  it("uses first-create-wins across repeated command IDs, new command IDs and changed names", async () => {
    const f = onboardingFixture();
    const first = await f.onboarding.create(initData(99), commandId, "Mehdi");
    for (const id of [commandId, commandId.toUpperCase(), userId])
      expect(await f.onboarding.create(initData(99), id, "Different")).toEqual(first);
    expect(f.accountsByTelegram.size).toBe(3);
    expect(f.accountRepository.createOrGet).toHaveBeenCalledTimes(1);
  });
  it("preserves legacy handles and returns the current profile on a later valid retry", async () => {
    const f = onboardingFixture();
    const row = f.accountsByTelegram.get(42n)!;
    f.accountsByTelegram.set(42n, { ...row, displayName: "Edited" });
    expect(await f.onboarding.create(initData(), commandId, "Ignored")).toEqual({
      ok: true,
      account: { schemaVersion: 1, userId, displayName: "Edited", publicHandle: "legacy_handle" },
    });
  });
  it.each([undefined, null, "", "bad", 123])(
    "rejects invalid command ID %# before account access",
    async (id) => {
      const f = onboardingFixture();
      expect(await f.onboarding.create(initData(99), id, "Mehdi")).toEqual(
        createErrorEnvelope("INVALID_INPUT"),
      );
      expect(f.create).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, null, 42, {}, "a".repeat(257)])(
    "rejects invalid transport name %# before account access",
    async (name) => {
      const f = onboardingFixture();
      expect(await f.onboarding.create(initData(99), commandId, name)).toEqual(
        createErrorEnvelope("INVALID_INPUT"),
      );
      expect(f.create).not.toHaveBeenCalled();
    },
  );
  it.each(["", "   ", "\u200c", "x\u202ey", "x\ny", "😀".repeat(41)])(
    "delegates domain name rejection %# to Users without creating a row",
    async (name) => {
      const f = onboardingFixture();
      expect(await f.onboarding.create(initData(99), commandId, name)).toEqual(
        createErrorEnvelope("INVALID_INPUT"),
      );
      expect(f.accountsByTelegram.has(99n)).toBe(false);
      expect(f.accountRepository.createOrGet).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, "forged", initData(99, now - 301), initData(99, now + 31)])(
    "denies unverified identity %# without accessing accounts",
    async (data) => {
      const f = onboardingFixture();
      expect(await f.onboarding.create(data, commandId, "Mehdi")).toEqual(
        createErrorEnvelope("UNAUTHENTICATED"),
      );
      expect(f.create).not.toHaveBeenCalled();
    },
  );
  it("returns only signed routing context and never treats it as membership", async () => {
    const f = onboardingFixture();
    const result = await f.onboarding.create(
      initData(99, now, "room_synthetic-code"),
      commandId,
      "Mehdi",
    );
    expect(result).toMatchObject({ ok: true, startParam: "room_synthetic-code" });
    expect(Object.keys(result).sort()).toEqual(["account", "ok", "startParam"]);
    expect(
      await f.onboarding.create(
        initData(99, now, "room_original").replace("room_original", "room_forged"),
        commandId,
        "Mehdi",
      ),
    ).toEqual(createErrorEnvelope("UNAUTHENTICATED"));
  });
  it("denies expiry during account creation but a fresh retry recovers the committed account", async () => {
    const f = onboardingFixture();
    const create = f.accounts.createForVerifiedTelegramIdentity.bind(f.accounts);
    f.create.mockImplementationOnce(async (...args) => {
      const result = await create(...args);
      f.clock.value += 301000;
      return result;
    });
    expect(await f.onboarding.create(initData(99), commandId, "Original")).toEqual(
      createErrorEnvelope("UNAUTHENTICATED"),
    );
    const committed = f.accountsByTelegram.get(99n)!;
    expect(await f.onboarding.create(initData(99, now + 301), commandId, "Changed")).toMatchObject({
      ok: true,
      account: { userId: committed.userId, displayName: "Original" },
    });
    expect(f.accountRepository.createOrGet).toHaveBeenCalledTimes(1);
  });
  it("rechecks eligibility after creation and returns no result for a newly blocked identity", async () => {
    const f = onboardingFixture();
    vi.mocked(f.users.findActiveByTelegramId).mockResolvedValueOnce(undefined);
    expect(await f.onboarding.create(initData(99), commandId, "Mehdi")).toEqual(
      createErrorEnvelope("UNAUTHENTICATED"),
    );
    expect(f.accountsByTelegram.has(99n)).toBe(true);
  });
  it("rejects a mismatched internal identity after creation", async () => {
    const f = onboardingFixture();
    vi.mocked(f.users.findActiveByTelegramId).mockResolvedValueOnce({ userId });
    expect(await f.onboarding.create(initData(99), commandId, "Mehdi")).toEqual(
      createErrorEnvelope("UNAUTHENTICATED"),
    );
  });
  it.each(["BLOCKED", "DELETED", "UNKNOWN"])("does not reactivate %s", async (status) => {
    const f = onboardingFixture();
    f.accountsByTelegram.set(42n, { ...f.accountsByTelegram.get(42n)!, status });
    expect(await f.onboarding.create(initData(), commandId, "Mehdi")).toEqual(
      createErrorEnvelope("UNAUTHENTICATED"),
    );
    expect(f.accountsByTelegram.get(42n)!.status).toBe(status);
  });
  it.each([-1, NaN, Infinity, 0.5, 8640000000000001])(
    "denies invalid server clock %#",
    async (value) => {
      const f = onboardingFixture();
      f.clock.value = value;
      expect(await f.onboarding.create(initData(99), commandId, "Mehdi")).toEqual(
        createErrorEnvelope("INTERNAL_ERROR"),
      );
      expect(f.create).not.toHaveBeenCalled();
    },
  );
  it("does not accept a backwards clock across async work", async () => {
    const f = onboardingFixture();
    vi.spyOn(f.clock, "nowMs")
      .mockReturnValueOnce(now * 1000)
      .mockReturnValueOnce(now * 1000 - 1);
    expect(await f.onboarding.create(initData(99), commandId, "Mehdi")).toEqual(
      createErrorEnvelope("UNAUTHENTICATED"),
    );
  });
  it("suppresses repository errors, including post-commit lookup failures", async () => {
    const f = onboardingFixture();
    f.create.mockRejectedValueOnce(new Error("SENSITIVE raw data"));
    expect(await f.onboarding.create(initData(99), commandId, "Mehdi")).toEqual(
      createErrorEnvelope("INTERNAL_ERROR"),
    );
    vi.mocked(f.users.findActiveByTelegramId).mockRejectedValueOnce(
      new Error("SENSITIVE connection"),
    );
    expect(await f.onboarding.create(initData(99), commandId, "Mehdi")).toEqual(
      createErrorEnvelope("INTERNAL_ERROR"),
    );
    expect((await f.onboarding.create(initData(99), commandId, "Mehdi")).ok).toBe(true);
  });
  it("rejects an oversized routing projection from a malformed verifier adapter", async () => {
    const f = onboardingFixture();
    const port = createMiniAppOnboarding({
      ...f,
      telegram: {
        verify: () => ({
          ok: true,
          identity: { telegramUserId: "99", authDate: now, startParam: "x".repeat(16385) },
        }),
      },
    });
    expect(await port.create(initData(99), commandId, "Mehdi")).toEqual(
      createErrorEnvelope("INVALID_INPUT"),
    );
    expect(f.create).not.toHaveBeenCalled();
  });
});

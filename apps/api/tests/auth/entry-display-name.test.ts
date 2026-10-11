import { describe, expect, it, vi } from "vitest";
import { createMiniAppOnboarding } from "../../src/auth/index.js";
import { registrationService } from "../../src/users/application/registration.js";
import { onboardingFixture } from "./onboarding-fixtures.js";
import { commandId, initData, now } from "./session-fixtures.js";

describe("chosen display name across direct Mini App entry", () => {
  it("completes a signed invite entry once and preserves the chosen name on retries", async () => {
    const f = onboardingFixture();
    const completed = new Set<bigint>();
    const read = vi.fn(async (id: bigint) => {
      const row = f.accountsByTelegram.get(id);
      return (
        row && {
          userId: row.userId,
          displayName: row.displayName,
          publicHandle: row.publicHandle,
          completed: completed.has(id),
        }
      );
    });
    const complete = vi.fn(async (id: bigint, _at: number, name: string) => {
      if (!completed.has(id)) {
        const row = f.accountsByTelegram.get(id)!;
        f.accountsByTelegram.set(id, { ...row, displayName: name });
        completed.add(id);
      }
      return read(id);
    });
    f.users.findActiveByTelegramId = vi.fn(async (id) => {
      const row = f.accountsByTelegram.get(BigInt(id));
      return row && { userId: row.userId, registrationCompleted: completed.has(BigInt(id)) };
    });
    const registration = registrationService({
      repository: { read, complete },
      accounts: f.accounts,
      clock: f.clock,
    });
    const service = createMiniAppOnboarding({
      registration,
      users: f.users,
      telegram: f.telegram,
      clock: f.clock,
    });
    const invite = "room_synthetic-invite";
    const signed = initData(99, now, invite);
    const first = await service.create(signed, commandId, "  مهدی  ");
    expect(first).toMatchObject({ ok: true, account: { displayName: "مهدی" }, startParam: invite });
    expect(completed.has(99n)).toBe(true);
    expect(await service.create(signed, commandId, "Different")).toEqual(first);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(f.accountRepository.createOrGet).toHaveBeenCalledTimes(1);
    expect(
      await service.create(signed.replace(invite, "room_forged"), commandId, "Other"),
    ).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("lets an incomplete technical account choose its name without renaming a completed account", async () => {
    const f = onboardingFixture();
    const completed = new Set<bigint>();
    const registration = registrationService({
      accounts: f.accounts,
      clock: f.clock,
      repository: {
        async read(id) {
          const row = f.accountsByTelegram.get(id);
          return (
            row && {
              userId: row.userId,
              displayName: row.displayName,
              publicHandle: row.publicHandle,
              completed: completed.has(id),
            }
          );
        },
        async complete(id, _at, name) {
          if (!completed.has(id)) {
            const row = f.accountsByTelegram.get(id)!;
            f.accountsByTelegram.set(id, { ...row, displayName: name });
            completed.add(id);
          }
          const row = f.accountsByTelegram.get(id)!;
          return {
            userId: row.userId,
            displayName: row.displayName,
            publicHandle: row.publicHandle,
            completed: true,
          };
        },
      },
    });
    expect(await registration.complete("42", "Chosen")).toMatchObject({
      ok: true,
      profile: { displayName: "Chosen" },
    });
    expect(await registration.complete("42", "Changed")).toMatchObject({
      ok: true,
      profile: { displayName: "Chosen" },
    });
    expect(await registration.complete("43", "\u202eunsafe")).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(f.accountsByTelegram.get(43n)?.displayName).toBe("Other");
  });
});

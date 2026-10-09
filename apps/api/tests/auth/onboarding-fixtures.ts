import { vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createMiniAppOnboarding } from "../../src/auth/index.js";
import {
  accountCreationService,
  type AccountCandidate,
  type AccountRecord,
} from "../../src/users/application/accounts.js";
import { fixture, userId, otherUserId } from "./session-fixtures.js";

/** Test-only storage: production uses the Users-owned PostgreSQL repository. */
export function onboardingFixture() {
  const f = fixture();
  const accountsByTelegram = new Map<bigint, AccountRecord>([
    [42n, { userId, displayName: "Existing", publicHandle: "legacy_handle", status: "ACTIVE" }],
    [
      43n,
      { userId: otherUserId, displayName: "Other", publicHandle: "other_10000", status: "ACTIVE" },
    ],
  ]);
  const repository = {
    findByTelegramId: vi.fn(async (id: bigint) => accountsByTelegram.get(id)),
    createOrGet: vi.fn(async (candidate: AccountCandidate) => {
      const record = accountsByTelegram.get(candidate.telegramUserId) ?? {
        userId: candidate.userId,
        displayName: candidate.displayName,
        publicHandle: candidate.publicHandle,
        status: "ACTIVE",
      };
      accountsByTelegram.set(candidate.telegramUserId, record);
      return record;
    }),
  };
  // Sessions and onboarding deliberately share the same eligibility adapter in this fixture.
  f.users.findActiveByTelegramId = vi.fn(async (id) => {
    const row = accountsByTelegram.get(BigInt(id));
    return row?.status === "ACTIVE"
      ? { userId: row.userId, registrationCompleted: true }
      : undefined;
  });
  f.users.findActiveById = vi.fn(async (id) => {
    const row = [...accountsByTelegram.values()].find((row) => row.userId === id);
    return row?.status === "ACTIVE"
      ? { userId: row.userId, registrationCompleted: true }
      : undefined;
  });
  const accounts = {
    ...accountCreationService({ repository, newUserId: randomUUID, newHandleSuffix: () => 65022 }),
  };
  const create = vi.spyOn(accounts, "createForVerifiedTelegramIdentity");
  const onboarding = {
    ...createMiniAppOnboarding({ accounts, users: f.users, telegram: f.telegram, clock: f.clock }),
  };
  return { ...f, accountsByTelegram, accounts, create, accountRepository: repository, onboarding };
}

import { z } from "zod";

/** Eligibility only; no Prisma record/profile is shared with Auth. */
export interface UserIdentity {
  readonly userId: string;
  readonly authVersion?: number;
  readonly registrationCompleted?: boolean;
}
export interface UserIdentityPort {
  findActiveByTelegramId(telegramUserId: string): Promise<UserIdentity | undefined>;
  findActiveById(userId: string): Promise<UserIdentity | undefined>;
}

export interface IdentityRepository {
  findByTelegramId(
    id: bigint,
  ): Promise<
    | { userId: string; status: string; authVersion?: number; registrationCompleted?: boolean }
    | undefined
  >;
  findById(
    id: string,
  ): Promise<
    | { userId: string; status: string; authVersion?: number; registrationCompleted?: boolean }
    | undefined
  >;
}
export function identityService(repository: IdentityRepository): UserIdentityPort {
  function eligible(
    row:
      | { userId: string; status: string; authVersion?: number; registrationCompleted?: boolean }
      | undefined,
  ): UserIdentity | undefined {
    return row?.status === "ACTIVE"
      ? Object.freeze({
          userId: row.userId,
          ...(row.authVersion === undefined ? {} : { authVersion: row.authVersion }),
          registrationCompleted: row.registrationCompleted === true,
        })
      : undefined;
  }
  return Object.freeze({
    async findActiveByTelegramId(id: string) {
      if (!/^[1-9][0-9]{0,18}$/.test(id)) return;
      const telegramId = BigInt(id);
      if (telegramId > 9223372036854775807n) return;
      return eligible(await repository.findByTelegramId(telegramId));
    },
    async findActiveById(id: string) {
      if (!z.uuid().safeParse(id).success) return;
      return eligible(await repository.findById(id.toLowerCase()));
    },
  });
}

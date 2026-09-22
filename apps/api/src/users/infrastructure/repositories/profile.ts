import { hash, randomUUID } from "node:crypto";
import { DatabaseError, type createDatabase } from "@hambazi/database";
import { createErrorEnvelope } from "@hambazi/contracts";
import {
  defaultSettings,
  settingsSchema,
  type ProfileRepository,
  type ProfilePatch,
} from "../../application/profile.js";

const retentionMs = 168 * 60 * 60 * 1000;
function digest(input: ProfilePatch) {
  // Fixed property order, normalized names and UUID; no raw patch history.
  return hash(
    "sha256",
    JSON.stringify([
      1,
      input.expectedVersion,
      input.patch.displayName ?? null,
      input.patch.settings?.locale ?? null,
      input.patch.settings?.theme ?? null,
    ]),
    "hex",
  );
}
export function createProfileRepository(
  database: ReturnType<typeof createDatabase>,
  clock: { nowMs(): number },
  newReceiptId: () => string = randomUUID,
): ProfileRepository {
  const scope = database.forModule("users");
  async function retry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (
          !(error instanceof DatabaseError) ||
          !["DATABASE_TRANSACTION_CONFLICT", "DATABASE_UNIQUE_CONFLICT"].includes(error.code) ||
          attempt >= 4
        )
          throw error;
      }
    }
  }
  function now() {
    const value = clock.nowMs();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000 - retentionMs)
      throw new Error("Invalid profile clock");
    return new Date(value);
  }
  return {
    read(userId) {
      return retry(() =>
        scope.transaction(async (db) => {
          const row = await db.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              displayName: true,
              publicHandle: true,
              profileVersion: true,
              status: true,
            },
          });
          if (!row || row.status !== "ACTIVE") return createErrorEnvelope("UNAUTHENTICATED");
          const prefs = await db.userSettings.findUnique({
            where: { userId },
            select: { schemaVersion: true, settingsJsonb: true },
          });
          if (prefs && prefs.schemaVersion !== 1) return createErrorEnvelope("INTERNAL_ERROR");
          const settings = settingsSchema.safeParse(prefs ? prefs.settingsJsonb : defaultSettings);
          if (!settings.success) return createErrorEnvelope("INTERNAL_ERROR");
          return {
            ok: true as const,
            profile: {
              schemaVersion: 1 as const,
              userId: row.id,
              displayName: row.displayName,
              publicHandle: row.publicHandle,
              version: row.profileVersion,
              settings: settings.data,
            },
          };
        }, "Serializable"),
      );
    },
    patch(userId, input) {
      const requestDigest = digest(input);
      return retry(() =>
        scope.transaction(async (db) => {
          const row = await db.user.findUnique({
            where: { id: userId },
            select: { status: true, profileVersion: true, displayName: true },
          });
          if (!row || row.status !== "ACTIVE") return createErrorEnvelope("UNAUTHENTICATED");
          const receipt = await db.profileMutationReceipt.findUnique({
            where: { userId_commandId: { userId, commandId: input.commandId } },
            select: { requestDigest: true, appliedVersion: true, expiresAt: true },
          });
          const at = now();
          if (receipt && receipt.expiresAt > at) {
            if (receipt.requestDigest !== requestDigest)
              return createErrorEnvelope("PROFILE_CONFLICT");
            return {
              ok: true as const,
              commandId: input.commandId,
              appliedVersion: receipt.appliedVersion,
            };
          }
          if (row.profileVersion !== input.expectedVersion)
            return createErrorEnvelope("PROFILE_CONFLICT");
          const prefs = await db.userSettings.findUnique({
            where: { userId },
            select: { schemaVersion: true, settingsJsonb: true },
          });
          if (prefs && prefs.schemaVersion !== 1) return createErrorEnvelope("INTERNAL_ERROR");
          const parsed = settingsSchema.safeParse(prefs ? prefs.settingsJsonb : defaultSettings);
          if (!parsed.success) return createErrorEnvelope("INTERNAL_ERROR");
          const settings = { ...parsed.data, ...input.patch.settings };
          const changed = await db.user.updateMany({
            where: { id: userId, status: "ACTIVE", profileVersion: input.expectedVersion },
            data: {
              profileVersion: { increment: 1 },
              displayName: input.patch.displayName ?? row.displayName,
            },
          });
          if (changed.count !== 1) return createErrorEnvelope("PROFILE_CONFLICT");
          if (input.patch.settings !== undefined)
            await db.userSettings.upsert({
              where: { userId },
              create: { userId, schemaVersion: 1, settingsJsonb: settings },
              update: { schemaVersion: 1, settingsJsonb: settings },
            });
          await db.profileMutationReceipt.deleteMany({
            where: { userId, commandId: input.commandId, expiresAt: { lte: at } },
          });
          await db.profileMutationReceipt.create({
            data: {
              id: newReceiptId(),
              userId,
              commandId: input.commandId,
              requestDigest,
              appliedVersion: input.expectedVersion + 1,
              createdAt: at,
              expiresAt: new Date(at.getTime() + retentionMs),
            },
          });
          return {
            ok: true as const,
            commandId: input.commandId,
            appliedVersion: input.expectedVersion + 1,
          };
        }, "Serializable"),
      );
    },
    async cleanup(limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw new Error("Invalid cleanup limit");
      const at = now();
      return scope.transaction(async (db) => {
        const rows = await db.profileMutationReceipt.findMany({
          where: { expiresAt: { lte: at } },
          select: { id: true },
          orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
          take: limit,
        });
        const ids = rows.map((row) => row.id);
        const result = await db.profileMutationReceipt.deleteMany({
          where: { id: { in: ids }, expiresAt: { lte: at } },
        });
        return result.count;
      });
    },
  };
}

import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import { z } from "zod";
import { normalizeDisplayName } from "../domain/account-name.js";

export const settingsSchema = z.strictObject({
  locale: z.enum(["auto", "fa", "en"]),
  theme: z.enum(["system", "light", "dark"]),
});
export const defaultSettings = Object.freeze({ locale: "auto", theme: "system" } as const);
export const profilePatchSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: z.uuid(),
  expectedVersion: z.number().int().min(0).max(2147483646),
  patch: z.strictObject({
    displayName: z.string().min(1).max(256).optional(),
    settings: settingsSchema.partial().optional(),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;
export type ProfilePatch = z.infer<typeof profilePatchSchema>;
export interface Profile {
  schemaVersion: 1;
  userId: string;
  displayName: string;
  publicHandle: string;
  version: number;
  settings: Settings;
}
export type ProfileFailure = ErrorEnvelope<
  "INVALID_INPUT" | "UNAUTHENTICATED" | "PROFILE_CONFLICT" | "INTERNAL_ERROR"
>;
export interface ProfileRepository {
  read(userId: string): Promise<{ ok: true; profile: Profile } | ProfileFailure>;
  patch(
    userId: string,
    input: ProfilePatch,
  ): Promise<{ ok: true; commandId: string; appliedVersion: number } | ProfileFailure>;
  cleanup(limit: number): Promise<number>;
}
export function profileService(repository: ProfileRepository) {
  return Object.freeze({
    async read(userId: string) {
      if (!z.uuid().safeParse(userId).success) return createErrorEnvelope("UNAUTHENTICATED");
      try {
        return await repository.read(userId.toLowerCase());
      } catch {
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
    async patch(userId: string, input: unknown) {
      if (!z.uuid().safeParse(userId).success) return createErrorEnvelope("UNAUTHENTICATED");
      const parsed = profilePatchSchema.safeParse(input);
      if (!parsed.success) return createErrorEnvelope("INVALID_INPUT");
      const v = parsed.data;
      if (
        Object.keys(v.patch).length === 0 ||
        (v.patch.settings !== undefined && Object.keys(v.patch.settings).length === 0)
      )
        return createErrorEnvelope("INVALID_INPUT");
      if (v.patch.displayName !== undefined) {
        const name = normalizeDisplayName(v.patch.displayName);
        if (name === undefined) return createErrorEnvelope("INVALID_INPUT");
        v.patch.displayName = name;
      }
      v.commandId = v.commandId.toLowerCase();
      try {
        return await repository.patch(userId.toLowerCase(), v);
      } catch {
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
  });
}
export type ProfilePort = ReturnType<typeof profileService>;

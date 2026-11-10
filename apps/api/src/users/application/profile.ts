import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import { z } from "zod";
import { normalizeDisplayName } from "../domain/account-name.js";

export const settingsSchema = z.strictObject({
  locale: z.enum(["auto", "fa", "en"]),
  theme: z.enum(["system", "light", "dark"]),
});
export const defaultSettings = Object.freeze({ locale: "auto", theme: "system" } as const);
export const usernameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_]+$/);
export const avatarSchema = z.union([
  z.enum([
    "default",
    "hb-01",
    "hb-02",
    "hb-03",
    "hb-04",
    "hb-05",
    "hb-06",
    "hb-07",
    "hb-08",
    "hb-09",
    "hb-10",
  ]),
  z
    .string()
    .max(240000)
    .regex(/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/),
]);
export const profilePatchSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: z.uuid(),
  expectedVersion: z.number().int().min(0).max(2147483646),
  patch: z.strictObject({
    displayName: z.string().min(1).max(256).optional(),
    username: usernameSchema.optional(),
    avatar: avatarSchema.optional(),
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
  username?: string | null;
  avatar?: string | null;
  version: number;
  settings: Settings;
}
export type ProfileFailure = ErrorEnvelope<
  "INVALID_INPUT" | "UNAUTHENTICATED" | "PROFILE_CONFLICT" | "INTERNAL_ERROR"
>;
export interface ProfileRepository {
  usernameAvailable(userId: string, username: string): Promise<boolean>;
  read(userId: string): Promise<{ ok: true; profile: Profile } | ProfileFailure>;
  patch(
    userId: string,
    input: ProfilePatch,
  ): Promise<{ ok: true; commandId: string; appliedVersion: number } | ProfileFailure>;
  cleanup(limit: number): Promise<number>;
}
export function profileService(repository: ProfileRepository) {
  return Object.freeze({
    async checkUsername(userId: string, input: unknown) {
      if (!z.uuid().safeParse(userId).success) return createErrorEnvelope("UNAUTHENTICATED");
      const parsed = usernameSchema.safeParse(input);
      if (!parsed.success) return createErrorEnvelope("INVALID_INPUT");
      try {
        return {
          ok: true as const,
          available: await repository.usernameAvailable(
            userId.toLowerCase(),
            parsed.data.toLowerCase(),
          ),
        };
      } catch {
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
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
      if (v.patch.username !== undefined) v.patch.username = v.patch.username.toLowerCase();
      try {
        return await repository.patch(userId.toLowerCase(), v);
      } catch {
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
  });
}
export type ProfilePort = ReturnType<typeof profileService>;

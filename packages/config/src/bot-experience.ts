import { z } from "zod";
export function parseBotExperienceConfig(env: Readonly<Record<string, string | undefined>>) {
  const parsed = z
    .object({
      BOT_SUPPORT_TIMEOUT_MS: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().min(60000).max(900000))
        .default(900000),
    })
    .safeParse(env);
  if (!parsed.success) throw new Error("Invalid Bot support configuration");
  return Object.freeze({ supportTimeoutMs: parsed.data.BOT_SUPPORT_TIMEOUT_MS });
}

import { z } from "zod";
const integer = (max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(max));
export function parseProfileConfig(env: Readonly<Record<string, string | undefined>>) {
  const result = z
    .object({ PROFILE_READ_LIMIT: integer(600), PROFILE_WRITE_LIMIT: integer(60) })
    .safeParse(env);
  if (!result.success) throw new Error("Profile configuration is invalid");
  return Object.freeze({
    readLimit: result.data.PROFILE_READ_LIMIT,
    writeLimit: result.data.PROFILE_WRITE_LIMIT,
  });
}

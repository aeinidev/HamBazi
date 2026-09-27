import { z } from "zod";
/** Opt-in as a group; preserves startup compatibility for the previous release. */
export function parseRoomsConfig(env: Readonly<Record<string, string | undefined>>) {
  if (
    [env.ROOM_TTL_SECONDS, env.ROOM_READ_LIMIT, env.ROOM_CREATE_LIMIT].every((v) => v === undefined)
  )
    return undefined;
  const integer = (max: number) =>
    z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(max));
  const parsed = z
    .object({
      ROOM_TTL_SECONDS: integer(2147483),
      ROOM_READ_LIMIT: integer(600),
      ROOM_CREATE_LIMIT: integer(60),
    })
    .safeParse(env);
  if (!parsed.success) throw new Error("Rooms configuration is invalid");
  return Object.freeze({
    ttlSeconds: parsed.data.ROOM_TTL_SECONDS,
    readLimit: parsed.data.ROOM_READ_LIMIT,
    createLimit: parsed.data.ROOM_CREATE_LIMIT,
  });
}

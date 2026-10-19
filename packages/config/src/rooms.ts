import { z } from "zod";
/** Opt-in as a group; preserves startup compatibility for the previous release. */
export function parseRoomsConfig(env: Readonly<Record<string, string | undefined>>) {
  if (
    [
      env.ROOM_TTL_SECONDS,
      env.ROOM_READ_LIMIT,
      env.ROOM_CREATE_LIMIT,
      env.ROOM_BOT_USERNAME,
      env.ROOM_APP_NAME,
      env.ROOM_MAIN_APP,
      env.ROOM_INVITE_LIMIT,
    ].every((v) => v === undefined)
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
  const enabled = [
    env.ROOM_BOT_USERNAME,
    env.ROOM_APP_NAME,
    env.ROOM_MAIN_APP,
    env.ROOM_INVITE_LIMIT,
  ].some((v) => v !== undefined);
  const main = env.ROOM_MAIN_APP === "true";
  if (env.ROOM_MAIN_APP !== undefined && (!main || env.ROOM_APP_NAME !== undefined))
    throw new Error("Rooms configuration is invalid");
  const invite = z
    .object({
      ROOM_BOT_USERNAME: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{4,31}(?![\s\S])/),
      ROOM_APP_NAME: main
        ? z.undefined().optional()
        : z.string().regex(/^[A-Za-z0-9_]{1,64}(?![\s\S])/),
      ROOM_INVITE_LIMIT: integer(600),
    })
    .safeParse(env);
  if (enabled && !invite.success) throw new Error("Rooms configuration is invalid");
  return Object.freeze({
    ...(enabled && invite.success
      ? {
          inviteLimit: invite.data.ROOM_INVITE_LIMIT,
          target: {
            botUsername: invite.data.ROOM_BOT_USERNAME,
            ...(main ? { mainApp: true as const } : { appName: invite.data.ROOM_APP_NAME! }),
          },
        }
      : {}),
    ttlSeconds: parsed.data.ROOM_TTL_SECONDS,
    readLimit: parsed.data.ROOM_READ_LIMIT,
    createLimit: parsed.data.ROOM_CREATE_LIMIT,
  });
}

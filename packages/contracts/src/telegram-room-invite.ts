/** Transport-only Telegram launch encoding. No identity or membership authority. */
export const roomInviteCodePattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048](?![\s\S])/;
export function parseRoomStartParam(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("room_")) return undefined;
  const code = value.slice(5);
  return roomInviteCodePattern.test(code) ? code : undefined;
}
export function buildRoomDeepLink(target: { botUsername: string; appName: string }, code: string) {
  if (
    !/^[A-Za-z][A-Za-z0-9_]{4,31}(?![\s\S])/.test(target.botUsername) ||
    !/^[A-Za-z0-9_]{1,64}(?![\s\S])/.test(target.appName) ||
    !roomInviteCodePattern.test(code)
  )
    throw new Error("Invalid room link input");
  return `https://t.me/${target.botUsername}/${target.appName}?startapp=room_${code}`;
}

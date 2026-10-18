import { buildRoomDeepLink, parseRoomStartParam } from "@hambazi/contracts";
import type { z } from "zod";
import { type roomSchema, previewSchema } from "../../platform/contracts.js";
import { ClientError } from "../../platform/errors.js";
import type { TelegramApp } from "../../platform/telegram.js";
import { kahrobaInviteSchema } from "./runtime.js";

export type KahrobaLobbyRoom = z.infer<typeof roomSchema>;
export type KahrobaLobbyInvite = z.infer<typeof kahrobaInviteSchema>["invite"];

/** UI affordance only. The existing authenticated host-only API remains authoritative. */
export function canShareKahrobaRoom(
  room: KahrobaLobbyRoom | undefined,
  userId: string | undefined,
  now: number,
): room is KahrobaLobbyRoom {
  return !!(
    userId &&
    room?.gameId === "kahroba" &&
    room.hostUserId === userId &&
    room.members.some((m) => m.userId === userId) &&
    ["WAITING", "FULL"].includes(room.status) &&
    room.expiresAt > now
  );
}

export function verifiedKahrobaInvite(
  input: unknown,
  room: KahrobaLobbyRoom,
  userId: string,
  now: number,
): KahrobaLobbyInvite {
  const response = kahrobaInviteSchema.safeParse(input);
  if (!response.success || !canShareKahrobaRoom(room, userId, now))
    throw new ClientError("INVALID_RESPONSE");
  const invite = response.data.invite,
    code = parseRoomStartParam(invite.startParam),
    url = new URL(invite.deepLink),
    parts = url.pathname.slice(1).split("/");
  if (
    !code ||
    invite.roomId !== room.id ||
    invite.expiresAt !== room.expiresAt ||
    invite.expiresAt <= now ||
    buildRoomDeepLink(
      response.data.schemaVersion === 2
        ? { botUsername: parts[0]!, mainApp: true }
        : { botUsername: parts[0]!, appName: parts[1]! },
      code,
    ) !== invite.deepLink
  )
    throw new ClientError("INVALID_RESPONSE");
  return invite;
}

export function verifyKahrobaInvitePreview(
  input: unknown,
  room: KahrobaLobbyRoom,
  invite: KahrobaLobbyInvite,
  now: number,
) {
  const result = previewSchema.safeParse(input);
  if (
    !result.success ||
    result.data.room.id !== room.id ||
    result.data.room.gameId !== "kahroba" ||
    result.data.room.capacity !== room.capacity ||
    !["WAITING", "FULL"].includes(result.data.room.status) ||
    result.data.room.expiresAt !== invite.expiresAt ||
    invite.expiresAt <= now
  )
    throw new ClientError("INVALID_RESPONSE");
}

/** Only a previously validated server invitation enters a share channel. No credential is shared. */
export async function shareKahrobaInvite(
  invite: KahrobaLobbyInvite,
  channels: {
    telegram?: Pick<TelegramApp, "openTelegramLink"> | undefined;
    share?: ((data: { title: string; text: string; url: string }) => Promise<void>) | undefined;
    copy?: ((text: string) => Promise<void>) | undefined;
  },
): Promise<"telegram" | "shared" | "copied" | "cancelled" | "unavailable"> {
  const text = "دعوت به اتاق خصوصی کهربا؛ فقط برای حساب آزمایشی تأییدشده";
  if (channels.telegram?.openTelegramLink) {
    const target = new URL("https://t.me/share/url");
    target.searchParams.set("url", invite.deepLink);
    target.searchParams.set("text", text);
    try {
      channels.telegram.openTelegramLink(target.href);
      return "telegram";
    } catch {
      // A missing native bridge may still allow the browser share sheet or clipboard.
    }
  }
  if (channels.share) {
    try {
      await channels.share({ title: "دعوت به کهربا", text, url: invite.deepLink });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
    }
  }
  if (channels.copy) {
    try {
      await channels.copy(invite.deepLink);
      return "copied";
    } catch {
      // Keep the verified link selectable in the lobby; never invent a replacement.
    }
  }
  return "unavailable";
}

import { describe, expect, it, vi } from "vitest";
import {
  canShareKahrobaRoom,
  verifiedKahrobaInvite,
  verifyKahrobaInvitePreview,
  shareKahrobaInvite,
  type KahrobaLobbyRoom,
} from "../../src/games/kahroba/lobby-invitation.js";

const owner = "11111111-1111-4111-8111-111111111111",
  guest = "22222222-2222-4222-8222-222222222222",
  room: KahrobaLobbyRoom = {
    id: "77777777-7777-4777-8777-777777777777",
    gameId: "kahroba",
    hostUserId: owner,
    capacity: 2,
    version: 3,
    expiresAt: 2000,
    status: "WAITING",
    startedMatchId: null,
    members: [{ userId: owner, seat: 0, joinedAt: 10, joinedVersion: 0 }],
  },
  code = "A".repeat(43),
  response = {
    ok: true,
    schemaVersion: 2,
    invite: {
      roomId: room.id,
      expiresAt: room.expiresAt,
      startParam: `room_${code}`,
      deepLink: `https://t.me/Hambazidev_bot?startapp=room_${code}`,
    },
  };

describe("Kahroba lobby secure invitation", () => {
  it("requires an authenticated current host, membership, Kahroba, open state and unexpired room", () => {
    expect(canShareKahrobaRoom(room, owner, 1000)).toBe(true);
    expect(canShareKahrobaRoom({ ...room, status: "FULL" }, owner, 1000)).toBe(true);
    for (const user of [guest, undefined])
      expect(canShareKahrobaRoom(room, user, 1000)).toBe(false);
    expect(canShareKahrobaRoom(undefined, owner, 1000)).toBe(false);
    expect(canShareKahrobaRoom({ ...room, members: [] }, owner, 1000)).toBe(false);
    expect(canShareKahrobaRoom({ ...room, gameId: "coup" }, owner, 1000)).toBe(false);
    for (const status of ["STARTING", "STARTED", "CLOSED", "EXPIRED"] as const)
      expect(canShareKahrobaRoom({ ...room, status }, owner, 1000)).toBe(false);
    expect(canShareKahrobaRoom(room, owner, 2000)).toBe(false);
  });

  it("accepts the exact bound server Main invitation without ROOM_APP_NAME and retains named v1", () => {
    expect(verifiedKahrobaInvite(response, room, owner, 1000)).toEqual(response.invite);
    const named = {
      ...response,
      schemaVersion: 1,
      invite: {
        ...response.invite,
        deepLink: `https://t.me/Hambazidev_bot/play?startapp=room_${code}`,
      },
    };
    expect(verifiedKahrobaInvite(named, room, owner, 1000)).toEqual(named.invite);
  });

  it("rejects mismatched room, expiry, invitation code, link version, destination and query injection", () => {
    for (const invite of [
      { ...response.invite, roomId: guest },
      { ...response.invite, expiresAt: 2001 },
      { ...response.invite, startParam: `room_${"E".repeat(43)}` },
      { ...response.invite, startParam: "K7B4" },
      ...[
        response.invite.deepLink.replace("t.me", "evil.example"),
        response.invite.deepLink + "&userId=forged",
        response.invite.deepLink + "\n",
        `https://t.me/Hambazidev_bot/play?startapp=room_${code}`,
      ].map((deepLink) => ({ ...response.invite, deepLink })),
    ])
      expect(() => verifiedKahrobaInvite({ ...response, invite }, room, owner, 1000)).toThrow();
    expect(() => verifiedKahrobaInvite(response, room, guest, 1000)).toThrow();
    expect(() => verifiedKahrobaInvite(response, room, owner, 2000)).toThrow();
  });

  it("requires authenticated resolution to the same unexpired Kahroba room before sharing", () => {
    const preview = {
      ok: true,
      schemaVersion: 1,
      room: {
        id: room.id,
        gameId: "kahroba",
        capacity: 2,
        version: 3,
        expiresAt: 2000,
        status: "WAITING",
      },
    };
    expect(() => verifyKahrobaInvitePreview(preview, room, response.invite, 1000)).not.toThrow();
    for (const change of [
      { id: guest },
      { gameId: "coup" },
      { capacity: 4 },
      { expiresAt: 2001 },
      { status: "EXPIRED" },
    ])
      expect(() =>
        verifyKahrobaInvitePreview(
          { ...preview, room: { ...preview.room, ...change } },
          room,
          response.invite,
          1000,
        ),
      ).toThrow();
    expect(() => verifyKahrobaInvitePreview(preview, room, response.invite, 2000)).toThrow();
  });

  it("uses only the native Telegram chooser with the exact verified link, without auth/identity data", async () => {
    const native = vi.fn(),
      share = vi.fn(),
      copy = vi.fn();
    expect(
      await shareKahrobaInvite(response.invite, {
        telegram: { openTelegramLink: native },
        share,
        copy,
      }),
    ).toBe("telegram");
    const url = new URL(native.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe("https://t.me/share/url");
    expect(url.searchParams.get("url")).toBe(response.invite.deepLink);
    expect([...url.searchParams.keys()].sort()).toEqual(["text", "url"]);
    expect(url.href).not.toMatch(/Bearer|accessToken|initData|userId|telegramUserId/);
    expect(share).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it("falls back to browser share and clipboard without copying after deliberate cancellation", async () => {
    const share = vi.fn(async () => {}),
      copy = vi.fn(async () => {});
    expect(await shareKahrobaInvite(response.invite, { share, copy })).toBe("shared");
    expect(copy).not.toHaveBeenCalled();
    share.mockRejectedValueOnce(Object.assign(new Error(), { name: "AbortError" }));
    expect(await shareKahrobaInvite(response.invite, { share, copy })).toBe("cancelled");
    expect(copy).not.toHaveBeenCalled();
    share.mockRejectedValueOnce(new Error("Unavailable"));
    expect(await shareKahrobaInvite(response.invite, { share, copy })).toBe("copied");
    expect(copy).toHaveBeenCalledWith(response.invite.deepLink);
    expect(await shareKahrobaInvite(response.invite, {})).toBe("unavailable");
  });
});

it("routes only explicit restricted test launches and canonical room invitations, never identity claims", async () => {
  const { kahrobaLaunch } = await import("../../src/games/kahroba/launch.js");
  expect(kahrobaLaunch("kahroba_test")).toEqual({ kind: "testing" });
  expect(kahrobaLaunch(`kahroba_test_${room.id}`)).toEqual({ kind: "testing", roomId: room.id });
  expect(kahrobaLaunch(response.invite.startParam)).toEqual({
    kind: "invite",
    startParam: response.invite.startParam,
  });
  for (const value of [
    undefined,
    "kahroba_test_fake",
    "kahroba_test?userId=owner",
    "room_K7B4",
    response.invite.startParam + "\n",
  ])
    expect(kahrobaLaunch(value)).toBeUndefined();
});

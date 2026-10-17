import { expect, it } from "vitest";
import { parseRoomsConfig } from "../src/index.js";
it("opts in only with a complete explicit room policy", () => {
  expect(parseRoomsConfig({})).toBeUndefined();
  expect(
    parseRoomsConfig({ ROOM_TTL_SECONDS: "900", ROOM_READ_LIMIT: "60", ROOM_CREATE_LIMIT: "5" }),
  ).toEqual({ ttlSeconds: 900, readLimit: 60, createLimit: 5 });
});
it.each([undefined, "", "0", "-1", "1.5", "secret", "2147484"])(
  "rejects missing/invalid lifetime safely (%s)",
  (ttl) => {
    expect(() =>
      parseRoomsConfig({ ROOM_TTL_SECONDS: ttl, ROOM_READ_LIMIT: "60", ROOM_CREATE_LIMIT: "5" }),
    ).toThrow("Rooms configuration is invalid");
  },
);
it.each([{ ROOM_READ_LIMIT: "601" }, { ROOM_CREATE_LIMIT: "61" }, { ROOM_READ_LIMIT: undefined }])(
  "rejects invalid room budgets",
  (patch) => {
    expect(() =>
      parseRoomsConfig({
        ROOM_TTL_SECONDS: "900",
        ROOM_READ_LIMIT: "60",
        ROOM_CREATE_LIMIT: "5",
        ...patch,
      }),
    ).toThrow();
  },
);

it("requires a complete explicit invite target and budget without changing prior startup", () => {
  const rooms = { ROOM_TTL_SECONDS: "900", ROOM_READ_LIMIT: "60", ROOM_CREATE_LIMIT: "5" };
  const invite = {
    ROOM_BOT_USERNAME: "HamBaziBot",
    ROOM_APP_NAME: "play",
    ROOM_INVITE_LIMIT: "10",
  };
  expect(parseRoomsConfig({ ...rooms, ...invite })).toMatchObject({
    inviteLimit: 10,
    target: { botUsername: "HamBaziBot", appName: "play" },
  });
  expect(() => parseRoomsConfig(invite)).toThrow();
  for (const patch of [
    { ROOM_APP_NAME: undefined },
    { ROOM_INVITE_LIMIT: "0" },
    { ROOM_INVITE_LIMIT: "601" },
    { ROOM_BOT_USERNAME: "bad/path" },
    { ROOM_APP_NAME: "play\n" },
  ])
    expect(() => parseRoomsConfig({ ...rooms, ...invite, ...patch })).toThrow(
      "Rooms configuration is invalid",
    );
});

it("selects the verified Main Mini App explicitly without a named short name", () => {
  const input = {
    ROOM_TTL_SECONDS: "900",
    ROOM_READ_LIMIT: "60",
    ROOM_CREATE_LIMIT: "5",
    ROOM_BOT_USERNAME: "Hambazidev_bot",
    ROOM_MAIN_APP: "true",
    ROOM_INVITE_LIMIT: "10",
  };
  expect(parseRoomsConfig(input)).toMatchObject({
    target: { botUsername: "Hambazidev_bot", mainApp: true },
  });
  expect(parseRoomsConfig(input)?.target).not.toHaveProperty("appName");
  for (const patch of [
    { ROOM_APP_NAME: "play" },
    { ROOM_APP_NAME: "" },
    { ROOM_MAIN_APP: "false" },
    { ROOM_MAIN_APP: "TRUE" },
    { ROOM_MAIN_APP: "true\n" },
    { ROOM_BOT_USERNAME: undefined },
    { ROOM_INVITE_LIMIT: undefined },
  ])
    expect(() => parseRoomsConfig({ ...input, ...patch })).toThrow(
      "Rooms configuration is invalid",
    );
});

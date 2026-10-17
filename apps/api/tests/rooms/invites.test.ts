import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { buildRoomDeepLink, parseRoomStartParam } from "@hambazi/contracts";
const target = { botUsername: "HamBaziBot", appName: "play" };
it("round trips server CSPRNG codes into canonical Telegram launch payloads", () => {
  const codes = Array.from({ length: 1000 }, () => randomBytes(32).toString("base64url"));
  expect(new Set(codes).size).toBe(codes.length);
  for (const code of codes) {
    expect(Buffer.from(code, "base64url")).toHaveLength(32);
    const link = new URL(buildRoomDeepLink(target, code));
    expect(link.origin + link.pathname).toBe("https://t.me/HamBaziBot/play");
    expect(parseRoomStartParam(link.searchParams.get("startapp"))).toBe(code);
  }
});
it.each([
  null,
  {},
  "",
  "A".repeat(43),
  "room_" + "A".repeat(42),
  "room_" + "A".repeat(44),
  "room_" + "A".repeat(42) + "B",
  "room_" + "A".repeat(43) + "\n",
  "room_%41" + "A".repeat(42),
  "room_" + "A".repeat(43) + "&userId=x",
  "https://t.me/bot/app?startapp=room_" + "A".repeat(43),
])("rejects noncanonical launch input %#", (value) => {
  expect(parseRoomStartParam(value)).toBeUndefined();
});
it.each(["evil/path", "evil?query", "evil#fragment", "evil\n", "@mybot", "evil.example"])(
  "rejects injected Telegram destinations %#",
  (value) => {
    expect(() => buildRoomDeepLink({ ...target, botUsername: value }, "A".repeat(43))).toThrow();
    expect(() => buildRoomDeepLink({ ...target, appName: value }, "A".repeat(43))).toThrow();
  },
);

it("round trips canonical Main Mini App links without changing named-app output", () => {
  const code = randomBytes(32).toString("base64url");
  const main = buildRoomDeepLink({ botUsername: "Hambazidev_bot", mainApp: true }, code);
  const url = new URL(main);
  expect(url.origin + url.pathname).toBe("https://t.me/Hambazidev_bot");
  expect(parseRoomStartParam(url.searchParams.get("startapp"))).toBe(code);
  expect(buildRoomDeepLink(target, code)).toBe(
    `https://t.me/HamBaziBot/play?startapp=room_${code}`,
  );
  for (const bad of [
    { botUsername: "evil/path", mainApp: true },
    { botUsername: "Hambazidev_bot", mainApp: true, appName: "play" },
    { botUsername: "Hambazidev_bot", mainApp: false },
    { botUsername: "Hambazidev_bot" },
  ])
    expect(() => buildRoomDeepLink(bad as never, code)).toThrow();
  expect(() =>
    buildRoomDeepLink({ botUsername: "Hambazidev_bot", mainApp: true }, code + "\n"),
  ).toThrow();
});

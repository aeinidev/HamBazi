import { expect, it } from "vitest";
import { catalogService } from "../../src/games/application/catalog.js";
export const baseline = {
  id: "coup",
  slug: "coup",
  title: "Coup",
  minPlayers: 2,
  maxPlayers: 6,
  matchmakingEnabled: false,
  privateRoomsEnabled: false,
  chatEnabled: false,
  voiceEnabled: false,
  status: "DISABLED",
  configSchemaVersion: 1,
  configJsonb: {},
};
it.each(["ACTIVE", "MAINTENANCE", "DISABLED"])(
  "projects %s without granting readiness",
  async (status) => {
    const row = {
      ...baseline,
      status,
      matchmakingEnabled: true,
      privateRoomsEnabled: true,
      chatEnabled: true,
    };
    const port = catalogService({ list: async () => [row], find: async () => row });
    const result = await port.find("coup");
    expect(result).toMatchObject({
      ok: true,
      game: {
        status,
        matchmakingModes: [{ id: "standard", title: "Standard" }],
        playable: false,
        descriptor: null,
        readiness: "NOT_IMPLEMENTED",
        matchmakingEnabled: false,
        privateRoomsEnabled: false,
        chatEnabled: false,
        voiceEnabled: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("configJsonb");
    expect(await port.list()).toMatchObject({ ok: true, games: [result.ok ? result.game : null] });
  },
);
it.each([
  { minPlayers: 1 },
  { maxPlayers: 7 },
  { title: "wrong" },
  { status: "UNKNOWN" },
  { voiceEnabled: true },
  { configSchemaVersion: 2 },
  { configJsonb: { secret: "private" } },
  { id: "other" },
  { slug: "other" },
  { matchmakingEnabled: "true" },
])("fails closed on unsupported stored metadata %j", async (patch) => {
  const row = { ...baseline, ...patch };
  const port = catalogService({ list: async () => [row], find: async () => row });
  expect(await port.list()).toEqual({ ok: false, error: { code: "INTERNAL_ERROR" } });
  expect(await port.find("coup")).toEqual({ ok: false, error: { code: "INTERNAL_ERROR" } });
});
it("distinguishes unknown slug, invalid input, missing baseline and dependency failure", async () => {
  const port = catalogService({ list: async () => [], find: async () => null });
  expect(await port.list()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  expect(await port.find("coup")).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  expect(await port.find("unknown")).toMatchObject({ error: { code: "NOT_FOUND" } });
  expect(await port.find("../private")).toMatchObject({ error: { code: "INVALID_INPUT" } });
  const broken = catalogService({
    list: async () => {
      throw new Error("secret");
    },
    find: async () => {
      throw new Error("secret");
    },
  });
  expect(await broken.list()).toEqual({ ok: false, error: { code: "INTERNAL_ERROR" } });
  expect(await broken.find("coup")).toEqual({ ok: false, error: { code: "INTERNAL_ERROR" } });
});

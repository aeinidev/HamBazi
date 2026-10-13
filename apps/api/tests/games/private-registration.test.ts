import { expect, it } from "vitest";
import { privateRegistrationService } from "../../src/games/application/private-registration.js";
const row = {
  id: "kahroba",
  slug: "kahroba",
  title: "کهربا",
  minPlayers: 2,
  maxPlayers: 4,
  status: "DISABLED",
  configSchemaVersion: 1,
  configJsonb: {},
};
const entry = {
  id: row.id,
  slug: row.slug,
  title: row.title,
  minPlayers: row.minPlayers,
  status: "ACTIVE" as const,
  maxPlayers: 2,
  playable: true,
  readiness: "NOT_IMPLEMENTED" as const,
  descriptor: null,
  matchmakingEnabled: false,
  privateRoomsEnabled: true,
  chatEnabled: false,
  voiceEnabled: false,
};
it("uses trusted private metadata without mutating durable/public registration", async () => {
  const port = privateRegistrationService(
    { find: async () => row, list: async () => [row] },
    entry,
  );
  expect(await port.find("kahroba")).toMatchObject({
    ok: true,
    game: { maxPlayers: 2, playable: true },
  });
  expect(row.status).toBe("DISABLED");
  expect(await port.find("coup")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
});
it.each([
  null,
  { ...row, status: "ACTIVE" },
  { ...row, configSchemaVersion: 2 },
  { ...row, maxPlayers: 1 },
  { ...row, configJsonb: { unapproved: true } },
])("fails closed on missing/foreign/unapproved metadata %j", async (stored) => {
  const port = privateRegistrationService(
    { find: async () => stored, list: async () => [] },
    entry,
  );
  expect(await port.find("kahroba")).toMatchObject({
    ok: false,
    error: { code: "INTERNAL_ERROR" },
  });
});

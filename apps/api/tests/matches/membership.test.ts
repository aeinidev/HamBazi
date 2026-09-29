import { describe, expect, it } from "vitest";
import { matchMembershipService } from "../../src/matches/application/membership.js";

const userId = "11111111-1111-4111-8111-111111111111";
const matchId = "22222222-2222-4222-8222-222222222222";
describe("match membership authorization", () => {
  it("returns only a role and match ID for a current member", async () => {
    const service = matchMembershipService({
      find: async () => ({ schemaVersion: 1, matchId, role: "SPECTATOR" }),
    });
    expect(await service.authorize(userId, { schemaVersion: 1, matchId })).toEqual({
      ok: true,
      value: { schemaVersion: 1, matchId, role: "SPECTATOR" },
    });
  });
  it("denies unknown users and unsupported shapes", async () => {
    const service = matchMembershipService({ find: async () => null });
    expect(await service.authorize(userId, { schemaVersion: 1, matchId })).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(await service.authorize("bad", { schemaVersion: 1, matchId })).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(await service.authorize(userId, { schemaVersion: 1, matchId, userId })).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });
  it("fails closed without exposing repository errors", async () => {
    const service = matchMembershipService({
      find: async () => {
        throw new Error("secret");
      },
    });
    expect(
      JSON.stringify(await service.authorize(userId, { schemaVersion: 1, matchId })),
    ).not.toContain("secret");
    expect(await service.authorize(userId, { schemaVersion: 1, matchId })).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
  });
});

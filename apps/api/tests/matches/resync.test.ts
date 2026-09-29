import { expect, it, vi } from "vitest";
import { matchResyncService } from "../../src/matches/application/resync.js";
import { MatchFault } from "../../src/matches/index.js";
const id = "11111111-1111-4111-8111-111111111111";
it("validates resync identity and cursor, hides projection errors and preserves stable owner faults", async () => {
  const read = vi.fn(async (): Promise<never> => {
    throw new Error("private deck");
  });
  const port = matchResyncService({ read });
  expect(await port.snapshot("forged", { schemaVersion: 1, matchId: id })).toMatchObject({
    error: { code: "UNAUTHENTICATED" },
  });
  expect(
    await port.catchup(id, { schemaVersion: 1, matchId: id, afterSeq: 2147483648 }),
  ).toMatchObject({ error: { code: "INVALID_INPUT" } });
  expect(await port.snapshot(id, { schemaVersion: 1, matchId: id, userId: id })).toMatchObject({
    error: { code: "INVALID_INPUT" },
  });
  expect(read).not.toHaveBeenCalled();
  const failure = await port.snapshot(id, { schemaVersion: 1, matchId: id });
  expect(failure).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  expect(JSON.stringify(failure)).not.toContain("deck");
  read.mockRejectedValueOnce(new MatchFault("NOT_FOUND"));
  expect(await port.catchup(id, { schemaVersion: 1, matchId: id, afterSeq: 0 })).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
});

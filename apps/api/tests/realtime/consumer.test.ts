import { expect, it, vi } from "vitest";
import { realtimeJobProcessor } from "../../src/realtime/index.js";
const id = "11111111-1111-4111-8111-111111111111";
const event = {
  schemaVersion: 1,
  eventId: id,
  aggregateId: id,
  occurredAt: 1000,
  correlation: {},
  type: "MATCH_CHANGED_V1",
  payload: { schemaVersion: 1, matchId: id, stateVersion: 1, lastEventSeq: 1, status: "ACTIVE" },
};
it("quarantines malformed/wrong-owner jobs and safely retries failed publication", async () => {
  const publish = vi.fn(async () => {});
  const process = realtimeJobProcessor(publish);
  await expect(process({ name: "MATCH_FINISHED_V1", data: event })).rejects.toThrow(
    "Invalid realtime job",
  );
  await expect(process({ name: "MATCH_CHANGED_V1", data: { deck: "secret" } })).rejects.toThrow(
    "Invalid realtime job",
  );
  expect(publish).not.toHaveBeenCalled();
  publish.mockRejectedValueOnce(new Error("sensitive transport cause"));
  await expect(process({ name: "MATCH_CHANGED_V1", data: event })).rejects.toThrow(
    "Realtime delivery failed",
  );
  expect(await process({ name: "MATCH_CHANGED_V1", data: event })).toEqual({
    schemaVersion: 1,
    status: "DELIVERED",
  });
  expect(await process({ name: "MATCH_CHANGED_V1", data: event })).toEqual({
    schemaVersion: 1,
    status: "DELIVERED",
  });
  expect(publish).toHaveBeenCalledTimes(3);
});

import { expect, it, vi } from "vitest";
import { z } from "zod";
import { publicFixture, cases, ids } from "../kahroba/fixtures.mjs";
import { snapshotSchema } from "../../src/platform/contracts.js";
import { toKahrobaView, publicKahrobaSnapshot } from "../../src/games/kahroba/adapters/index.js";
import { publicSnapshot } from "../../src/games/index.js";
import { createKahrobaCommandLifecycle } from "../../src/games/kahroba/store/index.js";
import { ClientError } from "../../src/platform/errors.js";
it.each(cases.filter((c) => c !== "failure"))(
  "validates the authoritative %s projection without importing rules in the browser",
  (name) => {
    const snapshot = snapshotSchema.parse(publicFixture(name));
    expect(toKahrobaView(snapshot, ids[0]!)).not.toBeNull();
    expect(publicSnapshot(snapshot, ids[0]!).view).toBeNull(); // Default runtime still denies Kahroba.
    expect(publicKahrobaSnapshot(snapshot, ids[0]!).view).not.toBeNull();
  },
);
it("fails closed on hidden fields, role/identity/version mismatch and corrupt shared results", () => {
  const s = snapshotSchema.parse(publicFixture("reserved")),
    v = s.view as Record<string, unknown>;
  for (const key of ["decks", "unusedNobles", "stateJsonb", "opponentReservations"])
    expect(toKahrobaView({ ...s, view: z.json().parse({ ...v, [key]: [] }) }, ids[0]!)).toBeNull();
  expect(toKahrobaView({ ...s, role: "SPECTATOR" }, ids[0]!)).toBeNull();
  expect(toKahrobaView(s, ids[1]!)).toBeNull();
  expect(toKahrobaView({ ...s, engineVersion: "unknown" }, ids[0]!)).toBeNull();
  const spectator = snapshotSchema.parse(publicFixture("spectator"));
  const parsed = toKahrobaView(spectator, ids[0]!);
  expect(parsed?.kind).toBe("SPECTATOR");
  expect(JSON.stringify(parsed)).not.toMatch(/myReserved|legalCommands|purchaseOptions|decks/);
  const shared = snapshotSchema.parse(publicFixture("shared"));
  const view = shared.view as Record<string, unknown>,
    result = view.result as Record<string, unknown>;
  expect(
    toKahrobaView(
      { ...shared, view: z.json().parse({ ...view, result: { ...result, winnerId: ids[0]! } }) },
      ids[0]!,
    ),
  ).toBeNull();
});
it("retains one immutable command identity for ambiguous retry, fences double taps and refreshes conflicts", async () => {
  const s = snapshotSchema.parse(publicFixture("initial")),
    view = toKahrobaView(s, ids[0]!)!;
  if (view.kind !== "PLAYER") throw new Error();
  const command = view.legalCommands[0]!,
    request = vi
      .fn()
      .mockRejectedValueOnce(new ClientError("NETWORK_ERROR", true))
      .mockResolvedValue({}),
    sync = vi.fn(async () => {}),
    newId = vi.fn(() => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const lifecycle = createKahrobaCommandLifecycle({ request, sync, newId, available: () => true });
  lifecycle.begin(s, command);
  expect(() => lifecycle.begin(s, command)).toThrow();
  await expect(lifecycle.execute()).rejects.toThrow();
  expect(lifecycle.blocked).toBe(true);
  await lifecycle.execute();
  expect(request.mock.calls[0]![0]).toEqual(request.mock.calls[1]![0]);
  expect(newId).toHaveBeenCalledOnce();
  expect(lifecycle.blocked).toBe(false);
  request.mockRejectedValueOnce(new ClientError("GAME_STATE_CONFLICT"));
  lifecycle.begin(s, command);
  await expect(lifecycle.execute()).rejects.toThrow();
  expect(sync).toHaveBeenCalledTimes(2);
  expect(lifecycle.blocked).toBe(false);
});
it("retains no offline command and discards private intent after spectator/session reset", async () => {
  const s = snapshotSchema.parse(publicFixture()),
    view = toKahrobaView(s, ids[0]!)!;
  if (view.kind !== "PLAYER") throw new Error();
  let available = false;
  const request = vi.fn(async () => {}),
    sync = vi.fn(async () => {});
  const lifecycle = createKahrobaCommandLifecycle({
    request,
    sync,
    newId: () => crypto.randomUUID(),
    available: () => available,
  });
  expect(() => lifecycle.begin(s, view.legalCommands[0])).toThrow();
  available = true;
  lifecycle.begin(s, view.legalCommands[0]);
  lifecycle.reset();
  await lifecycle.execute();
  expect(request).not.toHaveBeenCalled();
});

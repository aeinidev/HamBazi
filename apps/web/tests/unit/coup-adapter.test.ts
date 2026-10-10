import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../../src/platform/contracts.js";
import { toCoupView } from "../../src/games/coup/adapters/index.js";
import { publicSnapshot } from "../../src/games/index.js";

const goldens = JSON.parse(
  readFileSync(
    new URL(
      "../../../../packages/games/coup-engine/tests/fixtures/module-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
).goldens as Record<
  string,
  {
    revision: number;
    players: Array<{ viewerId: string; [key: string]: unknown }>;
    spectator: Record<string, unknown>;
  }
>;
const viewerId = goldens.WAITING_FOR_ACTION!.players[0]!.viewerId;
function snapshot(
  view: unknown,
  stateVersion: number,
  role: "PLAYER" | "SPECTATOR" = "PLAYER",
): Snapshot {
  return {
    schemaVersion: 1,
    matchId: "33333333-3333-4333-8333-333333333333",
    stateVersion,
    lastEventSeq: stateVersion,
    status: "ACTIVE",
    role,
    gameId: "coup",
    engineVersion: "coup-v1",
    stateSchemaVersion: 4,
    rulesetVersion: "coup-provisional-complete-v1",
    view: view as Snapshot["view"],
  };
}
describe("Coup public view boundary", () => {
  it("accepts every complete-engine golden player and spectator phase", () => {
    for (const [phase, golden] of Object.entries(goldens)) {
      for (const player of golden.players)
        expect(toCoupView(snapshot(player, golden.revision), player.viewerId)?.phase).toBe(phase);
      expect(
        toCoupView(snapshot(golden.spectator, golden.revision, "SPECTATOR"), viewerId)?.phase,
      ).toBe(phase);
    }
  });
  it("accepts independent Match and engine revisions", () => {
    const player = goldens.WAITING_FOR_ACTION!.players[0]!;
    expect(toCoupView(snapshot(player, 9), viewerId)?.revision).toBe(0);
  });
  it("rejects version, role, identity and extra hidden fields", () => {
    const base = goldens.WAITING_FOR_ACTION!;
    const player = base.players[0]!;
    expect(toCoupView({ ...snapshot(player, 0), rulesetVersion: "future" }, viewerId)).toBeNull();
    expect(toCoupView(snapshot(player, 0, "SPECTATOR"), viewerId)).toBeNull();
    expect(
      toCoupView(snapshot(player, 0), goldens.WAITING_FOR_ACTION!.players[1]!.viewerId),
    ).toBeNull();
    expect(toCoupView(snapshot({ ...player, deck: ["DUKE"] }, 0), viewerId)).toBeNull();
    const players = player.players as Array<Record<string, unknown>>;
    expect(
      toCoupView(
        snapshot(
          { ...player, players: [{ ...players[0], influence: ["DUKE"] }, ...players.slice(1)] },
          0,
        ),
        viewerId,
      ),
    ).toBeNull();
  });
  it("keeps only a validated public projection in session state", () => {
    const player = goldens.WAITING_FOR_ACTION!.players[0]!;
    expect(publicSnapshot(snapshot({ ...player, deck: ["DUKE"] }, 0), viewerId).view).toBeNull();
    expect(publicSnapshot(snapshot(player, 0), viewerId).view).toEqual(player);
    expect(publicSnapshot({ ...snapshot(player, 0), gameId: "unknown" }, viewerId).view).toBeNull();
  });
});

it("accepts the retained v2 public projection and denies hidden role metadata and identity mismatch", () => {
  const views = JSON.parse(
    readFileSync(new URL("../midnight/anarchist-views.json", import.meta.url), "utf8"),
  ) as Record<string, Record<string, unknown>>;
  const view = views["2-5"]!;
  const modern = {
    ...snapshot(view, 1),
    engineVersion: "coup-anarchist-v1",
    stateSchemaVersion: 5,
    rulesetVersion: "coup-anarchist-v1",
  };
  expect(toCoupView(modern, viewerId)?.stateSchemaVersion).toBe(5);
  for (const field of ["deck", "replacement", "defenseAvailable"])
    expect(
      publicSnapshot({ ...modern, view: { ...view, [field]: true } as Snapshot["view"] }, viewerId)
        .view,
    ).toBeNull();
  const players = view.players as Array<Record<string, unknown>>;
  expect(
    toCoupView(
      {
        ...modern,
        view: {
          ...view,
          players: [{ ...players[0], hasContessa: true }, ...players.slice(1)],
        } as Snapshot["view"],
      },
      viewerId,
    ),
  ).toBeNull();
  expect(toCoupView(modern, "99999999-9999-4999-8999-999999999999")).toBeNull();
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  kahrobaEngine as engine,
  migrateKahrobaState,
  upcastKahrobaEvent,
  type KahrobaState,
} from "../src/index.js";
const corpus = JSON.parse(
  readFileSync(new URL("./fixtures/replay-v1.json", import.meta.url), "utf8"),
) as {
  fixtures: Array<{
    players: number;
    initial: unknown;
    events: unknown[];
    earlyViews: unknown[];
    final: unknown;
    result: unknown;
  }>;
};
describe("retained version-one golden fixtures", () => {
  it.each(corpus.fixtures)(
    "replays $players seats to exact snapshots, projections and result",
    (fixture) => {
      let state: KahrobaState = migrateKahrobaState(fixture.initial, 1);
      const capture = () => ({
        players: state.players.map((p) => engine.getPlayerView(state, p.id)),
        spectator: engine.getSpectatorView(state),
      });
      expect(capture()).toEqual(fixture.earlyViews[0]);
      for (const [index, raw] of fixture.events.entries()) {
        state = engine.applyEvent(state, upcastKahrobaEvent(raw, 1));
        if (index < 4) expect(capture()).toEqual(fixture.earlyViews[index + 1]);
      }
      expect(state).toEqual(fixture.final);
      expect(engine.getResult(state)).toEqual(fixture.result);
      expect(migrateKahrobaState(fixture.final, 1)).toEqual(state);
      expect(state.metrics.timeouts).toBe(1);
    },
  );
});

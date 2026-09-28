import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canTransition, matchStatuses } from "../../src/matches/domain/lifecycle.js";
import {
  matchProcessingService,
  MatchFault,
  type MatchRequest,
} from "../../src/matches/application/processing.js";
import { createCoupMatchGame } from "../../src/composition/coup-match.js";
import { coupEngine, migrateCoupState } from "@hambazi/coup-engine";

import { rules } from "../fixtures/match-rules.js";
const actor = randomUUID();
const request = () => ({
  schemaVersion: 1,
  matchId: randomUUID(),
  actionId: randomUUID(),
  expectedVersion: 0,
});
function fixture() {
  const process = vi.fn(async (_actor: string | null, input: MatchRequest) => ({
    ...input,
    schemaVersion: 1 as const,
    stateVersion: 1,
    lastEventSeq: 1,
    status: "ACTIVE" as const,
  }));
  const users = {
    findActiveById: vi.fn(async () => ({ userId: actor })),
    findActiveByTelegramId: vi.fn(async () => undefined),
  };
  const port = matchProcessingService({ repository: { process }, users });
  return { port, process, users };
}
describe("Match lifecycle", () => {
  it("accepts only consecutive forward edges and termination from nonterminal states", () => {
    for (const [i, from] of matchStatuses.entries())
      for (const to of matchStatuses)
        expect(canTransition(from, to)).toBe(
          i < 5 && (to === "TERMINATED" || to === matchStatuses[i + 1]),
        );
  });
});
describe("Match application boundary", () => {
  it.each(["userId", "actorUserId", "source", "agentType"])("rejects injected %s", async (key) => {
    const f = fixture();
    expect(
      await f.port.command(actor, {
        ...request(),
        command: { type: "DECLARE_INCOME" },
        [key]: actor,
      }),
    ).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(f.process).not.toHaveBeenCalled();
  });
  it("checks Users before entering persistence and binds only supplied authenticated identity", async () => {
    const f = fixture();
    f.users.findActiveById.mockImplementation(async () => undefined as never);
    expect(await f.port.ready(actor, request())).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(f.process).not.toHaveBeenCalled();
  });
  it("separates trusted lifecycle from player commands", async () => {
    const f = fixture();
    const input = request();
    await f.port.lifecycle({ ...input, operation: "WAIT" });
    expect(f.process).toHaveBeenCalledWith(
      null,
      {
        ...input,
        kind: "LIFECYCLE",
        operation: "WAIT",
      },
      {},
    );
    expect(f.users.findActiveById).not.toHaveBeenCalled();
    await f.port.ready(actor, input);
    expect(f.process).toHaveBeenLastCalledWith(actor, { ...input, kind: "READY" }, {});
  });
  it("sanitizes failures but preserves stable domain codes", async () => {
    const f = fixture();
    f.process.mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_PAYLOAD"));
    expect(await f.port.ready(actor, request())).toMatchObject({
      error: { code: "INTERNAL_ERROR", message: "Operation failed" },
    });
    f.process.mockRejectedValueOnce(new MatchFault("GAME_STATE_CONFLICT"));
    expect(await f.port.ready(actor, request())).toMatchObject({
      error: { code: "GAME_STATE_CONFLICT" },
    });
  });
  it.each([-1, 2147483648, 0.1])("rejects invalid expectedVersion %s", async (expectedVersion) => {
    const f = fixture();
    expect(await f.port.ready(actor, { ...request(), expectedVersion })).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });
});
describe("server Coup Match adapter", () => {
  it("requires explicit rules and validates pinned snapshot and roster", () => {
    expect(() => createCoupMatchGame({})).toThrow("Invalid Coup Match configuration");
    const game = createCoupMatchGame(rules);
    const ids = [actor, randomUUID()];
    const state = game.initialize(ids, 1000);
    expect(game.restore(state, ids)).toEqual(state);
    expect(() => game.restore(state, [...ids].reverse())).toThrow(MatchFault);
    expect(() => game.restore({ secret: "SYNTHETIC" }, ids)).toThrow(MatchFault);
  });
  it("uses snapshotted rules despite changed adapter configuration and replays CSPRNG events", () => {
    const game = createCoupMatchGame(rules);
    const ids = [actor, randomUUID()];
    const snapshot = game.initialize(ids, 1000);
    const changed = createCoupMatchGame({ ...rules, incomeCoins: 2, actionTimeoutMs: 50 });
    const outcome = changed.execute(snapshot, { type: "DECLARE_INCOME" }, actor, 1001);
    const state = migrateCoupState(outcome.state, 4);
    expect(state.players[0]!.coins).toBe(3);
    expect(state.deadlineAt).toBe(2001);
    const event = outcome.events[0]!.payload;
    expect(
      coupEngine.applyEvent(
        migrateCoupState(snapshot, 4),
        event as Parameters<typeof coupEngine.applyEvent>[1],
      ),
    ).toEqual(state);
    expect(() => game.execute(snapshot, { type: "CHEAT" }, actor, 1001)).toThrow("INVALID_INPUT");
  });
});

it("accepts correlation only as validated trusted context, not as player envelope fields", async () => {
  const f = fixture();
  const input = { ...request(), command: { type: "DECLARE_INCOME" } };
  const correlation = {
    requestId: randomUUID(),
    traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
  };
  await f.port.command(actor, input, correlation);
  expect(f.process).toHaveBeenLastCalledWith(actor, { ...input, kind: "GAME" }, correlation);
  expect(
    await f.port.command(actor, { ...input, traceparent: correlation.traceparent }),
  ).toMatchObject({ error: { code: "INVALID_INPUT" } });
  expect(
    await f.port.command(actor, input, {
      traceparent: "00-00000000000000000000000000000000-2222222222222222-01",
    }),
  ).toMatchObject({ error: { code: "INVALID_INPUT" } });
});

import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createErrorEnvelope } from "@hambazi/contracts";
import {
  publicLobbyService,
  type PublicLobby,
  type PublicLobbyRepository,
} from "../../src/matches/application/public-lobby.js";
import type { MatchProcessingPort } from "../../src/matches/index.js";
function fixture() {
  const host = randomUUID(),
    guest = randomUUID(),
    matchId = randomUUID();
  const value: PublicLobby = {
    schemaVersion: 1,
    matchId,
    gameId: "kahroba",
    stateVersion: 1,
    status: "WAITING_FOR_PLAYERS",
    hostUserId: host,
    players: [
      { userId: host, seat: 0, ready: true },
      { userId: guest, seat: 1, ready: true },
    ],
  };
  const repository: PublicLobbyRepository = {
    read: vi.fn(async (actor) => ([host, guest].includes(actor) ? structuredClone(value) : null)),
    current: vi.fn(async () => null),
  };
  const lifecycle = vi
    .fn<MatchProcessingPort["lifecycle"]>()
    .mockResolvedValue(createErrorEnvelope("GAME_STATE_CONFLICT"));
  const processing = { lifecycle, ready: vi.fn(), command: vi.fn() };
  const service = publicLobbyService(repository, processing, {
    gameId: "kahroba",
    clock: { nowMs: () => 1000 },
  });
  const input = { schemaVersion: 1, matchId, actionId: randomUUID(), expectedVersion: 1 };
  return { host, guest, matchId, value, repository, lifecycle, processing, service, input };
}
it("keeps a completely ready public roster waiting until an explicit host command", async () => {
  const f = fixture();
  expect(await f.service.read(f.guest, f.matchId)).toEqual({ ok: true, value: f.value });
  expect(f.lifecycle).not.toHaveBeenCalled();
  expect(await f.service.begin(f.guest, f.input)).toMatchObject({ error: { code: "FORBIDDEN" } });
  expect(await f.service.cancel(f.guest, f.input)).toMatchObject({ error: { code: "FORBIDDEN" } });
  expect(f.lifecycle).not.toHaveBeenCalled();
  await f.service.begin(f.host, f.input);
  expect(f.lifecycle).toHaveBeenCalledExactlyOnceWith({ ...f.input, operation: "START" });
});
it("rejects nonmembers, foreign games and malformed/injected commands before lifecycle writes", async () => {
  const f = fixture();
  expect(await f.service.read(randomUUID(), f.matchId)).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  expect(await f.service.begin(f.host, { ...f.input, userId: f.host })).toMatchObject({
    error: { code: "INVALID_INPUT" },
  });
  f.value.gameId = "coup";
  f.value.status = "CREATED";
  expect(await f.service.read(f.host, f.matchId)).toMatchObject({ error: { code: "NOT_FOUND" } });
  expect(f.lifecycle).not.toHaveBeenCalled();
});
it("reuses the same recovery action after a failed step and never converts readiness into START", async () => {
  const f = fixture();
  f.value.status = "CREATED";
  f.lifecycle.mockResolvedValue(createErrorEnvelope("INTERNAL_ERROR"));
  expect(await f.service.read(f.host, f.matchId)).toMatchObject({
    error: { code: "INTERNAL_ERROR" },
  });
  expect(await f.service.read(f.guest, f.matchId)).toMatchObject({
    error: { code: "INTERNAL_ERROR" },
  });
  expect(f.lifecycle.mock.calls[0]).toEqual(f.lifecycle.mock.calls[1]);
  expect(f.lifecycle.mock.calls[0]?.[0]).toMatchObject({ operation: "WAIT", expectedVersion: 1 });
  f.value.status = "STARTING";
  await f.service.read(f.host, f.matchId);
  expect(f.lifecycle.mock.lastCall?.[0]).toMatchObject({ operation: "ACTIVATE" });
});
it("bounds cancellation to the waiting lobby and passes version/idempotency to the match owner", async () => {
  const f = fixture();
  await f.service.cancel(f.host, f.input);
  expect(f.lifecycle).toHaveBeenCalledExactlyOnceWith({ ...f.input, operation: "TERMINATE" });
  f.lifecycle.mockClear();
  f.value.status = "ACTIVE";
  expect(await f.service.cancel(f.host, f.input)).toMatchObject({
    error: { code: "GAME_STATE_CONFLICT" },
  });
  expect(f.lifecycle).not.toHaveBeenCalled();
});
it("returns only an actor-bound durable search projection and hides storage errors", async () => {
  const f = fixture();
  expect(await f.service.current(f.host)).toEqual({ ok: true, value: null });
  expect(f.repository.current).toHaveBeenCalledWith(f.host, "kahroba", 1000);
  vi.mocked(f.repository.current).mockRejectedValue(new Error("private database details"));
  const result = await f.service.current(f.host);
  expect(result).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  expect(JSON.stringify(result)).not.toContain("private database details");
});

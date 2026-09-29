import { vi } from "vitest";
import { createErrorEnvelope } from "@hambazi/contracts";
import type { RealtimeDependencies } from "../../src/realtime/index.js";
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const roomId = "33333333-3333-4333-8333-333333333333";
const matchId = "44444444-4444-4444-8444-444444444444";
const actionId = "55555555-5555-4555-8555-555555555555";
const ticketId = "66666666-6666-4666-8666-666666666666";
const origin = "https://mini.example";
export function realtimeDependencies() {
  const authenticate = vi.fn(async (token: unknown) =>
    token === "valid"
      ? {
          ok: true as const,
          session: { schemaVersion: 1 as const, userId, sessionId: otherId, expiresAt: 2000000000 },
        }
      : createErrorEnvelope("UNAUTHENTICATED"),
  );
  const readRoom = vi.fn(async (actor: unknown, id: unknown) =>
    actor === userId && id === roomId
      ? { ok: true as const, schemaVersion: 1 as const, room: { id: roomId } }
      : createErrorEnvelope("NOT_FOUND"),
  );
  const roomAck = {
    ok: true as const,
    schemaVersion: 1 as const,
    commandId: actionId,
    roomId,
    appliedVersion: 2,
  };
  const join = vi.fn(async () => roomAck);
  const leave = vi.fn(async () => roomAck);
  const start = vi.fn(async () => roomAck);
  const matchAck = {
    ok: true as const,
    value: {
      schemaVersion: 1 as const,
      matchId,
      actionId,
      stateVersion: 2,
      lastEventSeq: 3,
      status: "ACTIVE" as const,
    },
  };
  const command = vi.fn(async () => matchAck);
  const ready = vi.fn(async () => matchAck);
  const authorize = vi.fn(async (actor: unknown, input: unknown) =>
    actor === userId &&
    typeof input === "object" &&
    input !== null &&
    "matchId" in input &&
    input.matchId === matchId
      ? {
          ok: true as const,
          value: { schemaVersion: 1 as const, matchId, role: "PLAYER" as const },
        }
      : createErrorEnvelope("NOT_FOUND"),
  );
  const ticket = {
    schemaVersion: 1 as const,
    ticketId,
    status: "SEARCHING",
    expiresAt: 2000000000000,
    matchId: null,
  };
  const search = vi.fn(async () => ({ ok: true as const, value: ticket }));
  const read = vi.fn(async () => ({ ok: true as const, value: ticket }));
  const cancel = vi.fn(async () => ({ ok: true as const, value: ticket }));
  const found = vi.fn(async () => ({
    ok: true as const,
    value: {
      schemaVersion: 1,
      ticketId,
      matchId,
      expiresAt: 2000000000,
      admissionToken: { reveal: () => "admission-secret" },
    },
  }));
  const admit = vi.fn(async () => ({ ok: true as const, value: { schemaVersion: 1, matchId } }));
  const rate = vi.fn<RealtimeDependencies["rate"]>(async () => ({ allowed: true }));
  const ports = {
    sessions: { authenticate },
    rooms: { read: readRoom, join, leave, start },
    matches: { command, ready },
    membership: { authorize },
    matchmaking: { search, read, cancel, found, admit },
    rate,
    allowedOrigins: [origin],
    nowMs: () => 1000000000,
  } as unknown as RealtimeDependencies;
  return {
    ports,
    authenticate,
    readRoom,
    join,
    leave,
    start,
    command,
    ready,
    authorize,
    search,
    found,
    rate,
  };
}

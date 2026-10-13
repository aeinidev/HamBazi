import { randomUUID } from "node:crypto";
import type { createDatabase } from "@hambazi/database";
import { createErrorEnvelope } from "@hambazi/contracts";
import {
  createKahrobaMatchGame,
  kahrobaMatchDescriptor,
} from "../../dist/composition/kahroba-match.js";
import { createRoomsPort } from "../../dist/rooms/index.js";
import {
  createUserIdentityPort,
  createAccountCreationPort,
  createRegistrationPort,
} from "../../dist/users/index.js";
import { createAuthSessions } from "../../dist/auth/index.js";
import { createMatchProcessingPort, createPrivateRoomMatchPort } from "../../dist/matches/index.js";
import type { CatalogPort } from "../../dist/games/index.js";
import {
  migrateKahrobaState,
  kahrobaCards,
  zeroTokens,
  type kahrobaStateSchema,
} from "@hambazi/kahroba-engine";
import type { z } from "zod";

export const kahrobaRules = {
  rulesetVersion: "kahroba-base-v1",
  datasetVersion: "kahroba-economy-v1",
  turnDurationMs: null,
  timeoutPolicyVersion: null,
};
// Test-only eligibility. The real catalog and trusted default runtime stay unchanged.
export const isolatedKahrobaCatalog: CatalogPort = {
  list: async () => ({ ok: true, games: [] }),
  find: async (slug) =>
    slug !== "kahroba"
      ? createErrorEnvelope("NOT_FOUND")
      : {
          ok: true,
          game: {
            id: "kahroba",
            slug: "kahroba",
            title: "کهربا",
            minPlayers: 2,
            maxPlayers: 4,
            status: "ACTIVE",
            playable: true,
            readiness: "NOT_IMPLEMENTED",
            descriptor: null,
            matchmakingModes: [{ id: "standard", title: "Standard" }],
            matchmakingEnabled: true,
            privateRoomsEnabled: true,
            chatEnabled: false,
            voiceEnabled: false,
          },
        },
};
export function kahrobaSessions(
  database: ReturnType<typeof createDatabase>,
  clock = { nowMs: () => Date.now() },
) {
  return createAuthSessions({
    database,
    users: createUserIdentityPort(database),
    clock,
    lifetimeSeconds: 900,
    telegram: {
      verify: (input, at) => ({
        ok: true,
        identity: { telegramUserId: String(input), authDate: Math.floor(at / 1000) },
      }),
    },
    signing: {
      issuer: "kahroba-local",
      audience: "mini",
      activeKeyId: "test",
      keys: [{ id: "test", secret: { reveal: () => Buffer.alloc(32, 73).toString("base64url") } }],
    },
  });
}
let telegramSequence = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16);
export async function kahrobaFixture(
  a: ReturnType<typeof createDatabase>,
  b: ReturnType<typeof createDatabase>,
  count = 2,
) {
  const clock = { nowMs: () => Date.now() },
    game = createKahrobaMatchGame(kahrobaRules);
  const sessions = kahrobaSessions(a, clock);
  const ids: string[] = [],
    tokens: string[] = [];
  for (let seat = 0; seat < count; seat++) {
    const telegram = String(++telegramSequence);
    const account = await createAccountCreationPort(a).createForVerifiedTelegramIdentity(
      telegram,
      "Kahroba local",
    );
    if (!account.ok) throw new Error("Account fixture failed");
    await createRegistrationPort(a, clock).complete(telegram, `Kahroba ${telegram}`);
    const session = await sessions.issue(telegram, randomUUID());
    if (!session.ok) throw new Error("Session fixture failed");
    ids.push(account.account.userId);
    tokens.push(session.accessToken.reveal());
  }
  function compose(database = a) {
    const users = createUserIdentityPort(database);
    const rooms = createRoomsPort(
      database,
      { clock, ttlSeconds: 900 },
      {
        users,
        games: isolatedKahrobaCatalog,
        invites: {
          target: { botUsername: "HamBaziBot", appName: "play" },
          consume: async () => ({ allowed: true }),
        },
      },
    );
    const processing = createMatchProcessingPort(database, { clock, games: [game] }, users);
    const privateRooms = createPrivateRoomMatchPort(
      database,
      { clock },
      {
        rooms,
        processing,
        users,
        games: isolatedKahrobaCatalog,
        descriptor: async (input) => kahrobaMatchDescriptor(input),
      },
    );
    return { rooms, processing, privateRooms };
  }
  const first = compose(a),
    second = compose(b);
  const created = await first.rooms.create(ids[0], {
    schemaVersion: 1,
    commandId: randomUUID(),
    gameId: "kahroba",
    capacity: count,
  });
  if (!created.ok) throw new Error("Room fixture failed");
  const roomId = created.roomId;
  const invite = await first.rooms.shareInvite(ids[0], roomId);
  if (!invite.ok) throw new Error("Invite fixture failed");
  for (let seat = 1; seat < count; seat++) {
    const joined = await second.rooms.join(ids[seat], {
      schemaVersion: 1,
      commandId: randomUUID(),
      roomId,
      expectedVersion: seat - 1,
      inviteCode: invite.invite.startParam.slice(5),
    });
    if (!joined.ok) throw new Error("Join fixture failed");
  }
  async function stored() {
    return a.forModule("matches").execute(async (db) => {
      const match = await db.match.findUniqueOrThrow({ where: { roomId } });
      return {
        match,
        players: await db.matchPlayer.findMany({
          where: { matchId: match.id },
          orderBy: { seat: "asc" },
        }),
        events: await db.gameEvent.findMany({
          where: { matchId: match.id },
          orderBy: { seq: "asc" },
        }),
        commands: await db.processedCommand.findMany({
          where: { matchId: match.id },
          orderBy: { actionId: "asc" },
        }),
        outbox: await db.outboxEvent.findMany({
          where: { aggregateId: match.id },
          orderBy: { id: "asc" },
        }),
        result: await db.matchResult.findUnique({ where: { matchId: match.id } }),
        results: await db.gameResult.findMany({
          where: { matchId: match.id },
          orderBy: { userId: "asc" },
        }),
      };
    });
  }
  const request = (matchId: string, expectedVersion: number) => ({
    schemaVersion: 1 as const,
    matchId,
    actionId: randomUUID(),
    expectedVersion,
  });
  async function active() {
    const started = await first.privateRooms.start(ids[0], {
      schemaVersion: 1,
      commandId: randomUUID(),
      roomId,
      expectedVersion: count - 1,
    });
    if (!started.ok) throw new Error(`Start fixture failed: ${started.error.code}`);
    for (const id of ids) {
      const row = (await stored()).match;
      const ready = await first.privateRooms.ready(id, request(row.id, row.stateVersion));
      if (!ready.ok) throw new Error(`Ready fixture failed: ${ready.error.code}`);
    }
    return (await stored()).match.id;
  }
  return {
    a,
    b,
    clock,
    game,
    ids,
    tokens,
    sessions,
    roomId,
    first,
    second,
    compose,
    stored,
    request,
    active,
  };
}

/** Synthetic invariant-valid final-round edge fixture; not a historical full game. */
export async function installSharedFinalRound(f: Awaited<ReturnType<typeof kahrobaFixture>>) {
  const saved = await f.stored();
  const s = JSON.parse(JSON.stringify(saved.match.stateJsonb)) as z.infer<
    typeof kahrobaStateSchema
  >;
  s.firstPlayerIndex = 0;
  s.turnPlayerIndex = 0;
  s.revision = 60;
  s.turnNumber = 61;
  for (const p of s.players) p.turnsTaken = 30;
  function own(index: number, ids: number[], reserved = false) {
    for (const n of ids) {
      const id = `kahroba-card-${String(n).padStart(2, "0")}`;
      for (const deck of s.decks) {
        const i = deck.indexOf(id);
        if (i >= 0) deck.splice(i, 1);
      }
      for (let tier = 0; tier < 3; tier++)
        for (let slot = 0; slot < 4; slot++)
          if (s.market[tier]![slot] === id) s.market[tier]![slot] = s.decks[tier]!.shift() ?? null;
      (reserved ? s.players[index]!.reserved : s.players[index]!.purchased).push(id);
    }
  }
  own(0, [80, 81, 75]);
  own(1, [82, 83, 76]);
  own(0, [39], true);
  own(1, [35], true);
  s.players[0]!.tokens.sapphire = 3;
  s.bank.sapphire -= 3;
  s.players[1]!.tokens.emerald = 3;
  s.bank.emerald -= 3;
  const state = migrateKahrobaState(s, 1);
  await f.a.forModule("matches").execute((db) =>
    db.match.update({
      where: { id: saved.match.id },
      data: { stateJsonb: JSON.parse(JSON.stringify(state)), stateVersion: { increment: 1 } },
    }),
  );
  const commands = [
    {
      type: "BUY_CARD",
      source: "RESERVED",
      cardId: kahrobaCards.find((c) => c.id === "kahroba-card-39")!.id,
      payment: { ...zeroTokens(), sapphire: 3 },
    },
    {
      type: "BUY_CARD",
      source: "RESERVED",
      cardId: "kahroba-card-35",
      payment: { ...zeroTokens(), emerald: 3 },
    },
  ];
  return commands;
}

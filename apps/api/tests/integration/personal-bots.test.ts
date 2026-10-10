import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDatabase, DatabaseError } from "@hambazi/database";
import {
  coupAnarchistModule,
  coupAnarchistStateSchema,
  coupAnarchistPlayerViewSchema,
  type CoupRole,
  coupModule,
  coupPlayerViewSchema,
} from "@hambazi/coup-engine";
import {
  createPersonalMatchPort,
  createMatchAutomationPort,
  createMatchResyncPort,
} from "../../src/matches/index.js";
import { withPersonalPublicNames } from "../../src/composition/personal-public-names.js";
import { createPublicNamesPort } from "../../src/users/index.js";
import {
  createPersonalAnarchistCoupGame,
  createPersonalCoupGame,
} from "../../src/composition/personal-coup.js";
if (
  process.env.TEST_DATABASE_CONFIRM !== "isolated-hambazi-test" ||
  !process.env.API_DATABASE_URL ||
  !process.env.TEST_DATABASE_URL
)
  throw Error("Use isolated test:auth-http:local harness");
const config = {
  poolMax: 5,
  connectionTimeoutMs: 2000,
  idleTimeoutMs: 1000,
  transactionMaxWaitMs: 5000,
  transactionTimeoutMs: 5000,
};
const api = createDatabase({
    ...config,
    databaseUrl: { reveal: () => process.env.API_DATABASE_URL! },
  }),
  admin = createDatabase({
    ...config,
    databaseUrl: { reveal: () => process.env.TEST_DATABASE_URL! },
  });
beforeAll(() => Promise.all([api.connect(), admin.connect()]));
afterAll(() => Promise.all([api.disconnect(), admin.disconnect()]));
const game = createPersonalCoupGame();
let at = Date.now(),
  authorized = true;
const owner = randomUUID();
const policy = {
  telegramId: async () => "synthetic-test-only",
  admittedTelegramIds: async () => [],
  allowsTelegramId: async () => false,
  allowsUserId: async (id: string) => authorized && id === owner,
};
const port = createPersonalMatchPort(api, { game, clock: { nowMs: () => at }, owner: policy });
const automation = createMatchAutomationPort(api, {
  games: [game],
  clock: { nowMs: () => at },
  personal: true,
});
const parse = (result: Awaited<ReturnType<typeof port.read>>) => {
  if (!result.ok) throw Error(result.error.code);
  return result.value as {
    matchId: string;
    stateVersion: number;
    lastEventSeq: number;
    status: string;
    view: unknown;
  };
};
it("admits server seats without Users, finishes legal play, isolates views, and cleans up", async () => {
  await admin.forModule("users").execute((db) =>
    db.user.create({
      data: {
        id: owner,
        telegramUserId: BigInt(710000001),
        publicHandle: "personal_bots_fixture",
        displayName: "Personal fixture",
        status: "ACTIVE",
      },
    }),
  );
  const usersBefore = await admin.forModule("users").execute((db) => db.user.count());
  const denied = await port.start(randomUUID(), { schemaVersion: 1, commandId: randomUUID() });
  expect(denied.ok).toBe(false);
  expect(
    await api.forModule("matches").execute((db) =>
      db.matchBotSeat.count({
        where: { match: { players: { some: { userId: owner } } } },
      }),
    ),
  ).toBe(0);
  const commandId = randomUUID(),
    initial = parse(await port.start(owner, { schemaVersion: 1, commandId }));
  expect(parse(await port.start(owner, { schemaVersion: 1, commandId })).matchId).toBe(
    initial.matchId,
  );
  expect((await port.start(owner, { schemaVersion: 1, commandId: randomUUID() })).ok).toBe(false);
  const bot = await api
    .forModule("matches")
    .execute((db) => db.matchBotSeat.findFirstOrThrow({ where: { matchId: initial.matchId } }));
  expect(await admin.forModule("users").execute((db) => db.user.count())).toBe(usersBefore);
  await expect(
    api.forModule("matches").execute((db) =>
      db.matchBotSeat.update({
        where: { matchId_actorId: { matchId: initial.matchId, actorId: bot.actorId } },
        data: { seat: 2 },
      }),
    ),
  ).rejects.toBeInstanceOf(DatabaseError);
  expect(
    await admin
      .forModule("users")
      .execute((db) => db.user.findUnique({ where: { id: bot.actorId } })),
  ).toBe(null);
  expect((await port.read(bot.actorId, { schemaVersion: 1, matchId: initial.matchId })).ok).toBe(
    false,
  );
  expect(
    (
      await createMatchResyncPort(api, [game]).snapshot(owner, {
        schemaVersion: 1,
        matchId: initial.matchId,
      })
    ).ok,
  ).toBe(false);
  let moves = 0,
    botMoves = 0,
    finished = false;
  for (let i = 0; i < 500; i++) {
    const snapshot = parse(await port.read(owner, { schemaVersion: 1, matchId: initial.matchId }));
    const view = coupPlayerViewSchema.parse(snapshot.view);
    expect(view.viewerId).toBe(owner);
    expect(JSON.stringify(view)).not.toContain('"deck"');
    expect(JSON.stringify(view)).not.toContain('"influence"');
    if (snapshot.status === "FINISHED") {
      finished = true;
      break;
    }
    const command = coupModule.botPolicy.chooseCommand(view);
    if (command) {
      const body = {
        schemaVersion: 1,
        actionId: randomUUID(),
        matchId: initial.matchId,
        expectedVersion: snapshot.stateVersion,
        command,
      };
      const first = await port.command(owner, body);
      expect(first.ok).toBe(true);
      expect(await port.command(owner, body)).toEqual(first);
      moves++;
    }
    const planned = await automation.plan(initial.matchId);
    if (planned?.intent) {
      if (planned.intent.kind === "TIMER") at = Math.max(at, planned.intent.deadlineAt);
      else botMoves++;
      await automation.execute(planned.intent);
      const checkpoint = parse(
        await port.read(owner, { schemaVersion: 1, matchId: initial.matchId }),
      );
      await automation.execute(planned.intent);
      expect(
        parse(await port.read(owner, { schemaVersion: 1, matchId: initial.matchId })).stateVersion,
      ).toBe(checkpoint.stateVersion);
    }
    at += 1;
  }
  expect(finished).toBe(true);
  expect(moves).toBeGreaterThan(1);
  expect(botMoves).toBeGreaterThan(0);
  expect(
    await api
      .forModule("matches")
      .execute((db) => db.gameResult.count({ where: { matchId: initial.matchId } })),
  ).toBe(0);
  expect(
    await api
      .forModule("matches")
      .execute((db) => db.gameEvent.count({ where: { matchId: initial.matchId } })),
  ).toBe(
    parse(await port.read(owner, { schemaVersion: 1, matchId: initial.matchId })).lastEventSeq,
  );
  expect(await port.current(owner)).toEqual({
    ok: true,
    value: { schemaVersion: 1, matchId: null },
  });
  const closeStartId = randomUUID();
  const started = parse(await port.start(owner, { schemaVersion: 1, commandId: closeStartId }));
  authorized = false;
  expect(
    (
      await port.command(owner, {
        schemaVersion: 1,
        actionId: randomUUID(),
        matchId: started.matchId,
        expectedVersion: started.stateVersion,
        command: { type: "INCOME" },
      })
    ).ok,
  ).toBe(false);
  authorized = true;
  const closeBody = {
    schemaVersion: 1,
    actionId: randomUUID(),
    matchId: started.matchId,
    expectedVersion: started.stateVersion,
  };
  const closed = await port.close(owner, closeBody);
  expect(closed.ok).toBe(true);
  expect(await port.close(owner, closeBody)).toEqual(closed);
  const sameClosed = parse(await port.start(owner, { schemaVersion: 1, commandId: closeStartId }));
  expect(sameClosed.matchId).toBe(started.matchId);
  expect(sameClosed.status).toBe("TERMINATED");
  expect(await port.current(owner)).toEqual({
    ok: true,
    value: { schemaVersion: 1, matchId: null },
  });
  const racing = await Promise.all([
    port.start(owner, { schemaVersion: 1, commandId: randomUUID() }),
    port.start(owner, { schemaVersion: 1, commandId: randomUUID() }),
  ]);
  expect(racing.filter((r) => r.ok)).toHaveLength(1);
  expect(racing.filter((r) => !r.ok)).toHaveLength(1);
  const abandoned = parse(racing.find((r) => r.ok)!);
  at += 7200001;
  expect(await automation.plan(abandoned.matchId)).toBe(null);
  expect(await port.current(owner)).toEqual({
    ok: true,
    value: { schemaVersion: 1, matchId: null },
  });
  expect(await admin.forModule("users").execute((db) => db.user.count())).toBe(usersBefore);
}, 30000);

it("persists v2 payment/defense atomically, deduplicates racing attacks, restores both pins and exposes public names only", async () => {
  const actor = randomUUID();
  await admin.forModule("users").execute((db) =>
    db.user.create({
      data: {
        id: actor,
        telegramUserId: BigInt(710000002),
        publicHandle: "anarchist_fixture",
        displayName: "بازیکن آزمایشی با نام فارسی طولانی",
        status: "ACTIVE",
      },
    }),
  );
  const policy = { allowsUserId: async (id: string) => id === actor };
  const newGame = createPersonalAnarchistCoupGame();
  for (const defense of [false, true]) {
    const fixtureGame = {
      ...newGame,
      initialize(ids: readonly string[], at: number) {
        const s = coupAnarchistStateSchema.parse(newGame.initialize(ids, at));
        s.players[0]!.coins = 7;
        const target = s.players[1]!;
        const desired: CoupRole[] = defense ? ["CONTESSA", "CAPTAIN"] : ["DUKE", "CAPTAIN"];
        for (const [i, role] of desired.entries()) {
          if (target.influence[i] === role) continue;
          const j = s.deck.indexOf(role);
          if (j >= 0) [target.influence[i], s.deck[j]] = [s.deck[j]!, target.influence[i]!];
          else {
            const other = s.players[0]!;
            const k = other.influence.indexOf(role);
            expect(k).toBeGreaterThanOrEqual(0);
            [target.influence[i], other.influence[k]] = [other.influence[k]!, target.influence[i]!];
          }
        }
        return newGame.restore(s, ids);
      },
    };
    const port = withPersonalPublicNames(
      createPersonalMatchPort(api, {
        game: fixtureGame,
        retainedGames: [game],
        clock: { nowMs: () => at },
        owner: policy,
      }),
      createPublicNamesPort(api),
    );
    const start = parse(await port.start(actor, { schemaVersion: 1, commandId: randomUUID() }));
    const v = coupAnarchistPlayerViewSchema.parse(start.view);
    expect(v.players[0]!.displayName).toBe("بازیکن آزمایشی با نام فارسی طولانی");
    const targetId = v.players[1]!.id;
    const body = {
      schemaVersion: 1,
      actionId: randomUUID(),
      matchId: start.matchId,
      expectedVersion: start.stateVersion,
      command: { type: "DECLARE_ANARCHIST", targetId },
    };
    at++;
    const results = await Promise.all([port.command(actor, body), port.command(actor, body)]);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]).toEqual(results[0]);
    const stored = await api
      .forModule("matches")
      .execute((db) => db.match.findUniqueOrThrow({ where: { id: start.matchId } }));
    const internal = coupAnarchistStateSchema.parse(stored.stateJsonb);
    expect(internal.players[0]!.coins).toBe(2);
    expect(internal.phase).toBe(defense ? "WAITING_FOR_ACTION" : "LOSS");
    expect(internal.lastAction?.outcome).toBe(defense ? "DEFENDED" : "DECLARED");
    expect(
      await api
        .forModule("matches")
        .execute((db) =>
          db.processedCommand.count({ where: { matchId: start.matchId, actionId: body.actionId } }),
        ),
    ).toBe(1);
    expect(
      await api
        .forModule("matches")
        .execute((db) => db.gameEvent.count({ where: { matchId: start.matchId } })),
    ).toBe(stored.lastEventSeq);
    expect(
      await api
        .forModule("matches")
        .execute((db) => db.outboxEvent.count({ where: { aggregateId: start.matchId } })),
    ).toBe(2);
    const restored = createPersonalMatchPort(api, {
      game: newGame,
      retainedGames: [game],
      clock: { nowMs: () => at },
      owner: policy,
    });
    const read = parse(await restored.read(actor, { schemaVersion: 1, matchId: start.matchId }));
    const projection = coupAnarchistPlayerViewSchema.parse(read.view);
    expect(JSON.stringify(projection)).not.toContain('"deck"');
    expect(JSON.stringify(projection)).not.toContain('"replacement"');
    expect(projection.players[1]!.revealed).toEqual([]);
    expect((await restored.command(actor, { ...body, actionId: randomUUID() })).ok).toBe(false);
    expect(
      (await restored.read(randomUUID(), { schemaVersion: 1, matchId: start.matchId })).ok,
    ).toBe(false);
    const auto = createMatchAutomationPort(api, {
      games: [newGame, game],
      clock: { nowMs: () => at },
      personal: true,
    });
    let finished = false;
    for (let step = 0; step < 500; step++) {
      const snapshot = parse(
        await restored.read(actor, { schemaVersion: 1, matchId: start.matchId }),
      );
      if (snapshot.status === "FINISHED") {
        finished = true;
        break;
      }
      const choice = coupAnarchistModule.botPolicy.chooseCommand(
        coupAnarchistPlayerViewSchema.parse(snapshot.view),
      );
      if (choice)
        expect(
          (
            await restored.command(actor, {
              schemaVersion: 1,
              actionId: randomUUID(),
              matchId: start.matchId,
              expectedVersion: snapshot.stateVersion,
              command: choice,
            })
          ).ok,
        ).toBe(true);
      const plan = await auto.plan(start.matchId);
      if (plan?.intent) {
        if (plan.intent.kind === "TIMER") at = Math.max(at, plan.intent.deadlineAt);
        await auto.execute(plan.intent);
      }
      at++;
    }
    expect(finished).toBe(true);
  }
  const legacy = createPersonalMatchPort(api, { game, clock: { nowMs: () => at }, owner: policy });
  const old = parse(await legacy.start(actor, { schemaVersion: 1, commandId: randomUUID() }));
  const retained = createPersonalMatchPort(api, {
    game: newGame,
    retainedGames: [game],
    clock: { nowMs: () => at },
    owner: policy,
  });
  const oldView = parse(await retained.read(actor, { schemaVersion: 1, matchId: old.matchId }));
  expect(coupPlayerViewSchema.parse(oldView.view).engineVersion).toBe("coup-v1");
  expect(
    (
      await retained.command(actor, {
        schemaVersion: 1,
        actionId: randomUUID(),
        matchId: old.matchId,
        expectedVersion: old.stateVersion,
        command: { type: "DECLARE_INCOME" },
      })
    ).ok,
  ).toBe(true);
  const final = parse(await retained.read(actor, { schemaVersion: 1, matchId: old.matchId }));
  expect(
    (
      await retained.close(actor, {
        schemaVersion: 1,
        actionId: randomUUID(),
        matchId: old.matchId,
        expectedVersion: final.stateVersion,
      })
    ).ok,
  ).toBe(true);
}, 30000);

import {
  kahrobaEngine as engine,
  kahrobaCards,
  kahrobaNobles,
  migrateKahrobaState,
  zeroTokens,
} from "../../../../packages/games/kahroba-engine/dist/index.js";
export const ids = [0, 1, 2, 3].map((i) => `00000000-0000-4000-8000-00000000000${i}`);
export const names = { [ids[0]]: "mehdi", [ids[1]]: "سارا", [ids[2]]: "علی", [ids[3]]: "رضا" };
const rules = {
  rulesetVersion: "kahroba-base-v1",
  datasetVersion: "kahroba-economy-v1",
  turnDurationMs: null,
  timeoutPolicyVersion: null,
};
const clone = (s) => JSON.parse(JSON.stringify(s));
function detach(s, id) {
  for (const deck of s.decks) {
    const index = deck.indexOf(id);
    if (index >= 0) deck.splice(index, 1);
  }
  for (let t = 0; t < 3; t++)
    for (let slot = 0; slot < 4; slot++)
      if (s.market[t][slot] === id) s.market[t][slot] = s.decks[t].shift() ?? null;
}
function own(s, index, values, reserved = false) {
  for (const n of values) {
    const id = typeof n === "number" ? `kahroba-card-${String(n).padStart(2, "0")}` : n;
    detach(s, id);
    (reserved ? s.players[index].reserved : s.players[index].purchased).push(id);
  }
}
function bonuses(s, counts) {
  for (const [color, n] of Object.entries(counts)) {
    const occupied = new Set(s.players.flatMap((p) => [...p.purchased, ...p.reserved]));
    own(
      s,
      0,
      kahrobaCards
        .filter((c) => c.bonus === color && c.prestige === 0 && !occupied.has(c.id))
        .slice(0, n)
        .map((c) => c.id),
    );
  }
}
function tokens(s, index, values) {
  for (const color of Object.keys(s.bank)) {
    s.bank[color] += s.players[index].tokens[color];
    s.players[index].tokens[color] = values[color] ?? 0;
    s.bank[color] -= s.players[index].tokens[color];
  }
}
function turn(s, command) {
  return engine
    .execute(s, command, s.players[s.turnPlayerIndex].id, {
      clock: { now: () => s.lastCommandAt + 1 },
      random: {
        nextInt: () => {
          throw new Error("No turn randomness");
        },
      },
      rules: s.rules,
    })
    .reduce(engine.applyEvent, s);
}
export const cases = [
  "initial",
  "opponent",
  "affordable",
  "returns",
  "nobles",
  "reserved",
  "empty",
  "spectator",
  "sole",
  "shared",
  "failure",
];
export function fixture(name = "initial", capacity = 4) {
  if (!cases.includes(name) || ![2, 3, 4].includes(capacity))
    throw new Error("Unknown preview fixture");
  const n = name === "sole" || name === "shared" ? 2 : capacity;
  let s = clone(
    engine.createInitialState(
      { playerIds: ids.slice(0, n) },
      {
        clock: { now: () => 1000 },
        random: { nextInt: (bound) => (name === "opponent" ? 1 % bound : 0) },
        rules,
      },
    ),
  );
  if (!["initial", "opponent", "failure"].includes(name)) {
    s.firstPlayerIndex = 0;
    s.turnPlayerIndex = 0;
    s.revision = n * 30;
    s.turnNumber = s.revision + 1;
    for (const p of s.players) p.turnsTaken = 30;
  }
  if (["affordable", "reserved"].includes(name)) {
    bonuses(s, { diamond: 2, sapphire: 2, emerald: 2, ruby: 2, onyx: 2 });
    tokens(s, 0, { diamond: 1, sapphire: 1, emerald: 1, ruby: 1, onyx: 1, gold: 1 });
  }
  if (name === "reserved" || name === "spectator") own(s, 0, [s.decks[1][0]], true);
  if (name === "returns") tokens(s, 0, { diamond: 3, sapphire: 3, emerald: 2, ruby: 2 });
  if (name === "nobles") bonuses(s, { diamond: 3, sapphire: 3, emerald: 3, ruby: 3, onyx: 3 });
  if (name === "empty")
    for (const [i, c] of kahrobaCards.filter((c) => c.tier === 1).entries()) own(s, i % n, [c.id]);
  if (name === "sole" || name === "shared") {
    own(s, 0, [80, 81, 75]);
    own(s, 1, [82, 83, 76]);
    if (name === "sole") own(s, 1, [24]);
    own(s, 0, [39], true);
    own(s, 1, [35], true);
    tokens(s, 0, { sapphire: 3 });
    tokens(s, 1, { emerald: 3 });
    s = turn(migrateKahrobaState(s, 1), {
      type: "BUY_CARD",
      source: "RESERVED",
      cardId: "kahroba-card-39",
      payment: { ...zeroTokens(), sapphire: 3 },
    });
    s = turn(s, {
      type: "BUY_CARD",
      source: "RESERVED",
      cardId: "kahroba-card-35",
      payment: { ...zeroTokens(), emerald: 3 },
    });
  }
  return {
    state: migrateKahrobaState(s, 1),
    role: name === "spectator" ? "SPECTATOR" : "PLAYER",
    failure: name === "failure",
  };
}
export { engine, kahrobaNobles };
export function publicFixture(name = "initial", capacity = 4) {
  const f = fixture(name, capacity);
  return {
    schemaVersion: 1,
    matchId: "55555555-5555-4555-8555-555555555555",
    stateVersion: 1,
    lastEventSeq: 1,
    status: f.state.phase === "GAME_OVER" ? "FINISHED" : "ACTIVE",
    role: f.role,
    gameId: "kahroba",
    engineVersion: f.failure ? "unsupported" : "kahroba-v1",
    stateSchemaVersion: 1,
    rulesetVersion: "kahroba-base-v1",
    view:
      f.role === "SPECTATOR"
        ? engine.getSpectatorView(f.state)
        : engine.getPlayerView(f.state, ids[0]),
  };
}

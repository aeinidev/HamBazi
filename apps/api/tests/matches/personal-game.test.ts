import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { coupPlayerViewSchema, coupModule } from "@hambazi/coup-engine";
import { createPersonalCoupGame } from "../../src/composition/personal-coup.js";
it("pins valid personal rules, projects only the actor view, and validates the bot move normally", () => {
  const game = createPersonalCoupGame(),
    ids = [randomUUID(), randomUUID()],
    state = game.initialize(ids, 1000);
  const view = coupPlayerViewSchema.parse(game.project(state, ids[0]!, "PLAYER"));
  expect(view.viewerId).toBe(ids[0]);
  expect(JSON.stringify(view)).not.toContain('"deck"');
  expect(view.myCards).toHaveLength(2);
  const command = coupModule.botPolicy.chooseCommand(view);
  expect(command).not.toBe(null);
  expect(game.execute(state, command, ids[0]!, 1001).events.length).toBeGreaterThan(0);
  expect(() => game.execute(state, command, randomUUID(), 1001)).toThrow();
});

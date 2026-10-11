import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { personalStartSchema } from "../../src/matches/index.js";

it.each(["hokm", "kahroba", "chess", "domino", "ludo"])(
  "does not let the personal Coup start command select %s",
  (gameId) => {
    expect(
      personalStartSchema.safeParse({ schemaVersion: 1, commandId: randomUUID(), gameId }).success,
    ).toBe(false);
  },
);

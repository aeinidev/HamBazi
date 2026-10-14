import { expect, it } from "vitest";
import { lobbyAvailability } from "../../src/games/index.js";
it.each([true, false])(
  "pause overrides personal admission %s without enabling other games",
  (admitted) => {
    const availability = lobbyAvailability({ coupTemporarilyDisabled: true }, admitted);
    expect(availability.find((game) => game.id === "coup")?.state).toBe("TEMPORARILY_DISABLED");
    expect(
      availability
        .filter((game) => game.id !== "coup")
        .every((game) => game.state === "COMING_SOON"),
    ).toBe(true);
  },
);
it("unpausing does not widen admission and never rolls out Kahroba", () => {
  expect(
    lobbyAvailability({ coupTemporarilyDisabled: false }, false).find((game) => game.id === "coup")
      ?.state,
  ).toBe("COMING_SOON");
  expect(
    lobbyAvailability({ coupTemporarilyDisabled: false }, true).find((game) => game.id === "coup")
      ?.state,
  ).toBe("AVAILABLE");
  expect(
    lobbyAvailability({ coupTemporarilyDisabled: false }, true).find(
      (game) => game.id === "kahroba",
    )?.state,
  ).toBe("COMING_SOON");
});

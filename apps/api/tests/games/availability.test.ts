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
it("unpausing Coup does not implicitly enable Kahroba", () => {
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

it.each([true, false])(
  "Kahroba entry follows its own admission, independent of Coup pause %s",
  (paused) => {
    const games = lobbyAvailability({ coupTemporarilyDisabled: paused }, false, true);
    expect(games.find((game) => game.id === "kahroba")?.state).toBe("AVAILABLE");
    expect(
      games
        .filter((game) => !["coup", "kahroba"].includes(game.id))
        .every((game) => game.state === "COMING_SOON"),
    ).toBe(true);
    expect(
      lobbyAvailability({ coupTemporarilyDisabled: paused }, true, false).find(
        (game) => game.id === "kahroba",
      )?.state,
    ).toBe("COMING_SOON");
  },
);

import { expect, it } from "vitest";
import { parseGameAvailabilityConfig } from "../src/index.js";
it("pauses by default and permits only explicit reversible configuration", () => {
  expect(parseGameAvailabilityConfig({})).toEqual({ coupTemporarilyDisabled: true });
  expect(parseGameAvailabilityConfig({ COUP_TEMPORARILY_DISABLED: "true" })).toEqual({
    coupTemporarilyDisabled: true,
  });
  expect(parseGameAvailabilityConfig({ COUP_TEMPORARILY_DISABLED: "false" })).toEqual({
    coupTemporarilyDisabled: false,
  });
});
it.each(["", "0", "1", "TRUE", "no"])("rejects malformed flag %s", (flag) => {
  expect(() => parseGameAvailabilityConfig({ COUP_TEMPORARILY_DISABLED: flag })).toThrow(
    "GAME_AVAILABILITY_CONFIGURATION_INVALID",
  );
});

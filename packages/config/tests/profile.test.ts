import { expect, it } from "vitest";
import { parseProfileConfig } from "../src/profile.js";
it("requires explicit bounded profile budgets", () => {
  expect(parseProfileConfig({ PROFILE_READ_LIMIT: "60", PROFILE_WRITE_LIMIT: "10" })).toEqual({
    readLimit: 60,
    writeLimit: 10,
  });
  for (const env of [
    {},
    { PROFILE_READ_LIMIT: "601", PROFILE_WRITE_LIMIT: "10" },
    { PROFILE_READ_LIMIT: "60", PROFILE_WRITE_LIMIT: "0" },
    { PROFILE_READ_LIMIT: "60", PROFILE_WRITE_LIMIT: "61" },
    { PROFILE_READ_LIMIT: "secret", PROFILE_WRITE_LIMIT: "10" },
  ]) {
    expect(() => parseProfileConfig(env)).toThrow("Profile configuration is invalid");
  }
});

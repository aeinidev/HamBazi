import { expect, it } from "vitest";
import { createCatalogRate } from "../../src/games/index.js";
it.each([0, 601, -1, 1.5, NaN, Infinity])(
  "rejects invalid quota %s before connecting",
  (readLimit) => {
    expect(() =>
      createCatalogRate({
        url: { reveal: () => "redis://localhost:1" },
        namespace: "test",
        readLimit,
      }),
    ).toThrow("Invalid catalog rate configuration");
  },
);
it("rejects unsafe namespaces and reports a disconnected client safely", async () => {
  expect(() =>
    createCatalogRate({
      url: { reveal: () => "redis://localhost:1" },
      namespace: "unsafe\n",
      readLimit: 60,
    }),
  ).toThrow("Invalid catalog rate configuration");
  const rate = createCatalogRate({
    url: { reveal: () => "redis://localhost:1" },
    namespace: "test",
    readLimit: 60,
  });
  expect(await rate.consume("00000000-0000-4000-8000-000000000001")).toEqual({
    allowed: false,
    reason: "unavailable",
  });
  rate.close();
});

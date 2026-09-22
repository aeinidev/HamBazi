import { expect, it } from "vitest";
import { parseCatalogConfig } from "../src/index.js";
it.each(["1", "60", "600"])("accepts explicit catalog quota %s", (value) => {
  expect(parseCatalogConfig({ CATALOG_READ_LIMIT: value })).toEqual({ readLimit: Number(value) });
});
it.each([undefined, "0", "601", "1.5", "-1", "secret", " 60"])(
  "rejects invalid catalog quota safely",
  (value) => {
    expect(() => parseCatalogConfig({ CATALOG_READ_LIMIT: value })).toThrow(
      "Catalog configuration is invalid",
    );
  },
);

import { expect, it } from "vitest";
import { componentSourceCommit, selectedComponentRoles } from "../release/component-provenance.mjs";

it("retains legacy source provenance while allowing a separately rebuilt ingress", () => {
  const original = "a".repeat(40),
    patched = "b".repeat(40);
  const inventory = { sourceCommit: original };
  expect(componentSourceCommit(inventory, { role: "acme" })).toBe(original);
  expect(componentSourceCommit(inventory, { role: "ingress", sourceCommit: patched })).toBe(
    patched,
  );
  for (const sourceCommit of ["", "mutable-tag", "c".repeat(39)])
    expect(() => componentSourceCommit(inventory, { sourceCommit })).toThrow();
  expect(() => componentSourceCommit({}, {})).toThrow();
});

it("preserves the original default build and permits only an explicit unique component subset", () => {
  expect(selectedComponentRoles()).toEqual(["ingress", "acme"]);
  expect(selectedComponentRoles(["ingress"])).toEqual(["ingress"]);
  for (const roles of [[], ["api"], ["ingress", "ingress"], "ingress"])
    expect(() => selectedComponentRoles(roles)).toThrow();
});

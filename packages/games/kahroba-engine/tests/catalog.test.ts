import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { kahrobaCards, kahrobaNobles, GEM_COLORS } from "../src/index.js";
const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const colors = ["diamond", "sapphire", "emerald", "ruby", "onyx"] as const;
describe("verified licensed economic inventory", () => {
  it("matches every value in the pinned MIT card resource", () => {
    const source = read("cards.txt");
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "a067b515826f5baa417ed92ec8076794baf6959f5409ba062932636b9f2cdfad",
    );
    const names = {
      white: "diamond",
      blue: "sapphire",
      green: "emerald",
      red: "ruby",
      black: "onyx",
    };
    const rows = source
      .toString()
      .split(/\r?\n/)
      .filter((r) => r.trim() && !r.trim().startsWith("#"));
    expect(rows).toHaveLength(90);
    for (const row of rows) {
      const r = row.split(",").map((x) => x.trim());
      const c = kahrobaCards[Number(r[0])]!;
      expect([c.tier, c.bonus, c.prestige, ...colors.map((color) => c.cost[color])]).toEqual([
        Number(r[6]) + 1,
        names[r[7] as keyof typeof names],
        Number(r[8]),
        ...r.slice(1, 6).map(Number),
      ]);
    }
  });
  it("matches all ten nobles using the raw header, independently of the broken upstream loader", () => {
    const source = read("nobles.txt");
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      "dd4110ab7173b052af9a58cdfbeea5746ace3af8af49bbc2eae0edbb0cefa1a1",
    );
    const rows = source
      .toString()
      .split(/\r?\n/)
      .filter((r) => r.trim() && !r.trim().startsWith("#"));
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      const r = row.split(",").map(Number),
        n = kahrobaNobles[r[0]!]!;
      expect([n.prestige, ...colors.map((c) => n.requirements[c])]).toEqual(r.slice(1));
    }
  });
  it("pins independently verified tuple hash, tiers, colors, requirements and provenance", () => {
    const provenance = JSON.parse(
      readFileSync(new URL("../dataset-provenance.json", import.meta.url), "utf8"),
    ) as {
      developmentVerification: { matchedTuples: number; mismatches: number };
      canonicalSha256: string;
    };
    const rows = kahrobaCards.map((c, i) => [
      i,
      c.tier,
      c.bonus,
      c.prestige,
      ...colors.map((k) => c.cost[k]),
    ]);
    const nobles = kahrobaNobles.map((n, i) => [
      i,
      n.prestige,
      ...colors.map((k) => n.requirements[k]),
    ]);
    expect(
      createHash("sha256")
        .update(JSON.stringify({ cards: rows, nobles }))
        .digest("hex"),
    ).toBe(provenance.canonicalSha256);
    expect(provenance.developmentVerification).toMatchObject({ matchedTuples: 90, mismatches: 0 });
    for (const [tier, count] of [
      [1, 40],
      [2, 30],
      [3, 20],
    ]) {
      expect(kahrobaCards.filter((c) => c.tier === tier)).toHaveLength(count!);
      for (const color of GEM_COLORS)
        expect(kahrobaCards.filter((c) => c.tier === tier && c.bonus === color)).toHaveLength(
          count! / 5,
        );
    }
    expect(new Set(kahrobaNobles.map((n) => JSON.stringify(n.requirements))).size).toBe(10);
    for (const n of kahrobaNobles)
      expect(Object.values(n.requirements).filter(Boolean).sort()).toEqual(
        Object.values(n.requirements).includes(4) ? [4, 4] : [3, 3, 3],
      );
    expect(kahrobaCards[25]!.cost).toEqual({
      diamond: 3,
      sapphire: 1,
      emerald: 0,
      ruby: 0,
      onyx: 1,
    });
    expect(Object.isFrozen(kahrobaCards[25]!.cost)).toBe(true);
  });
});

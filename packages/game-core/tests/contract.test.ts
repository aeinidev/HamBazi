import { describe, expect, expectTypeOf, it } from "vitest";
import {
  gameManifestSchema,
  gameVersionDescriptorSchema,
  type GameEngine,
  type RuleConfig,
} from "../src/index.js";

describe("game module foundation", () => {
  it("validates a disabled manifest and rejects incoherent capacity or duplicate modes", () => {
    const manifest = {
      id: "coup",
      slug: "coup",
      title: "Coup",
      minPlayers: 2,
      maxPlayers: 6,
      modes: ["standard"],
      matchmakingEnabled: false,
      privateRoomsEnabled: false,
      chatEnabled: false,
      voiceEnabled: false,
      status: "DISABLED",
    };
    expect(gameManifestSchema.safeParse(manifest).success).toBe(true);
    expect(gameManifestSchema.safeParse({ ...manifest, minPlayers: 7 }).success).toBe(false);
    expect(
      gameManifestSchema.safeParse({ ...manifest, modes: ["standard", "standard"] }).success,
    ).toBe(false);
    expect(gameManifestSchema.safeParse({ ...manifest, descriptor: "injected" }).success).toBe(
      false,
    );
  });

  it("requires every pin and both schema versions", () => {
    const descriptor = {
      engineVersion: "engine-v1",
      stateSchemaVersion: 1,
      rulesetVersion: "rules-v1",
      commandSchemaVersion: 1,
      eventSchemaVersion: 1,
    };
    expect(gameVersionDescriptorSchema.safeParse(descriptor).success).toBe(true);
    expect(
      gameVersionDescriptorSchema.safeParse({ ...descriptor, eventSchemaVersion: 0 }).success,
    ).toBe(false);
    expect(
      gameVersionDescriptorSchema.safeParse({ ...descriptor, rulesetVersion: "" }).success,
    ).toBe(false);
  });

  it("keeps rule, clock and randomness dependencies in the engine type", () => {
    type Engine = GameEngine<unknown, unknown, unknown, unknown, unknown, RuleConfig>;
    expectTypeOf<Parameters<Engine["createInitialState"]>[1]>().toHaveProperty("clock");
    expectTypeOf<Parameters<Engine["createInitialState"]>[1]>().toHaveProperty("random");
    expectTypeOf<Parameters<Engine["createInitialState"]>[1]>().toHaveProperty("rules");
  });
});

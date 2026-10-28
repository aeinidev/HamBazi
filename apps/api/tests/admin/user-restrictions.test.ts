import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { adminFixture, password, ownerPin } from "./fixture.js";
import { adminCommandRequestSchema, adminUserQuerySchema } from "@hambazi/validation";
import { adminAccess } from "../../src/admin/domain/access.js";
async function fixture(enabled = true) {
  const f = await adminFixture();
  await f.enroll();
  const pending = await f.service.login({
    schemaVersion: 1,
    commandId: randomUUID(),
    username: "owner_fixture",
    password,
  });
  const login = await f.service.pin(pending.token, {
    schemaVersion: 1,
    commandId: randomUUID(),
    pin: ownerPin,
  });
  let effects = 0;
  const m = f.management(
    {
      USER_RESTRICT: {
        target: async () => ({ gameId: null, version: 0 }),
        execute: async () => {
          effects++;
          return { code: "APPLIED" };
        },
        outcome: async () => null,
      },
    },
    enabled,
  );
  return {
    f,
    m,
    token: login.token,
    get effects() {
      return effects;
    },
  };
}
describe("phase three security admission", () => {
  it("reconciles an already committed receipt with writes disabled without another effect", async () => {
    const t = await fixture();
    let durable: { code: string } | null = null,
      effects = 0;
    const products = {
      USER_RESTRICT: {
        target: async () => ({ gameId: null, version: 0 }),
        outcome: async () => durable,
        execute: async () => {
          effects++;
          durable = { code: "APPLIED" };
          throw new Error("SYNTHETIC_RESPONSE_LOST");
        },
      },
    };
    const enabled = t.f.management(products, true),
      commandId = randomUUID();
    await enabled.request(t.token, {
      schemaVersion: 1,
      commandId,
      reasonCode: "ABUSE",
      action: {
        operation: "USER_RESTRICT",
        targetId: randomUUID(),
        expectedVersion: 0,
        duration: "HOUR_1",
      },
    });
    const auth = await enabled.approve(t.token, commandId, {
      schemaVersion: 1,
      commandId: randomUUID(),
      password,
      pin: ownerPin,
      confirmed: true,
    });
    expect((await enabled.execute(auth.token, commandId)).state).toBe("UNKNOWN");
    const disabled = t.f.management(products, false);
    await disabled.reconcilePending();
    expect((await disabled.status(auth.token, commandId)).state).toBe("SUCCEEDED");
    await expect(disabled.execute(auth.token, commandId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(effects).toBe(1);
    expect(
      t.f.state.audit.filter((r) => r.commandId === commandId && r.event === "OPERATION_SUCCEEDED"),
    ).toHaveLength(1);
  });

  it("validates fixed durations, exact user intent and bounded confidential input", () => {
    const input = {
      schemaVersion: 1,
      commandId: randomUUID(),
      reasonCode: "ABUSE",
      action: {
        operation: "USER_RESTRICT",
        targetId: randomUUID(),
        expectedVersion: 0,
        duration: "HOUR_1",
      },
    };
    expect(adminCommandRequestSchema.safeParse(input).success).toBe(true);
    expect(adminUserQuerySchema.safeParse({ search: "x" + String.fromCharCode(0) }).success).toBe(
      false,
    );
    expect(
      adminCommandRequestSchema.safeParse({ ...input, privateNote: "x".repeat(2001) }).success,
    ).toBe(false);
    expect(
      adminCommandRequestSchema.safeParse({
        ...input,
        action: { ...input.action, duration: "CUSTOM" },
      }).success,
    ).toBe(false);
    expect(
      adminCommandRequestSchema.safeParse({
        ...input,
        action: { ...input.action, status: "ACTIVE" },
      }).success,
    ).toBe(false);
  });
  it("stays closed by default even for OWNER and old users.manage grants confer no new authority", async () => {
    const t = await fixture(false);
    await expect(
      t.m.request(t.token, {
        schemaVersion: 1,
        commandId: randomUUID(),
        reasonCode: "ABUSE",
        action: {
          operation: "USER_RESTRICT",
          targetId: randomUUID(),
          expectedVersion: 0,
          duration: "PERMANENT",
        },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(t.effects).toBe(0);
    const p = {
      operatorId: randomUUID(),
      isOwner: false,
      environment: "test",
      authorizationVersion: 1,
      policyRevision: 1,
      grants: [{ permission: "users.manage", environment: "test", gameIds: null, deny: false }],
    };
    expect(adminAccess(p, "users.restrictions.manage")).toBe(false);
  });
  it("does not admit on missing reason, Audit failure or unapproved execution, and never leaks note in responses", async () => {
    const t = await fixture(),
      commandId = randomUUID();
    const input = {
      schemaVersion: 1,
      commandId,
      reasonCode: "ABUSE",
      action: {
        operation: "USER_RESTRICT",
        targetId: randomUUID(),
        expectedVersion: 0,
        duration: "HOUR_1",
      },
      privateNote: "یادداشت محرمانه",
    };
    await expect(
      t.m.request(t.token, { ...input, reasonCode: "MAINTENANCE" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    t.f.failAudit();
    await expect(t.m.request(t.token, input)).rejects.toThrow();
    expect(t.f.state.operations.has(commandId)).toBe(false);
    t.f.restoreAudit();
    const request = await t.m.request(t.token, input);
    expect(request.hasPrivateNote).toBe(true);
    expect(JSON.stringify(request)).not.toContain(input.privateNote);
    expect(JSON.stringify(t.f.state.audit)).not.toContain(input.privateNote);
    await expect(t.m.execute(t.token, commandId)).rejects.toMatchObject({ code: "ADMIN_CONFLICT" });
    t.f.failAudit();
    await expect(t.m.privateNote(t.token, commandId)).rejects.toThrow();
    expect(t.effects).toBe(0);
    t.f.restoreAudit();
    expect(await t.m.privateNote(t.token, commandId)).toEqual({
      schemaVersion: 1,
      privateNote: input.privateNote,
    });
    const id = randomUUID();
    const owner = t.f.state.operators.get(t.f.state.realm!.ownerId!)!;
    t.f.state.operators.set(id, {
      ...owner,
      id,
      username: "note_reader_fixture",
      pinVerifier: null,
    });
    const grant = (permission: string, deny = false) => ({
      permission,
      environment: "test",
      gameIds: null,
      deny,
    });
    t.f.state.grants.set(id, [grant("users.restrictions.notes.view")]);
    const reader = await t.f.service.login({
      schemaVersion: 1,
      commandId: randomUUID(),
      username: "note_reader_fixture",
      password,
    });
    await expect(t.m.privateNote(reader.token, commandId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    t.f.state.grants.set(id, [
      grant("users.restrictions.notes.view"),
      grant("users.restrictions.view"),
    ]);
    expect((await t.m.privateNote(reader.token, commandId)).privateNote).toBe(input.privateNote);
    t.f.state.grants.set(id, [
      grant("users.restrictions.notes.view"),
      grant("users.restrictions.view"),
      grant("users.restrictions.notes.view", true),
    ]);
    await expect(t.m.privateNote(reader.token, commandId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const approved = await t.m.approve(t.token, commandId, {
      schemaVersion: 1,
      commandId: randomUUID(),
      password,
      pin: ownerPin,
      confirmed: true,
    });
    t.f.failAudit();
    await expect(t.m.execute(approved.token, commandId)).rejects.toThrow();
    expect(t.effects).toBe(0);
  });
});

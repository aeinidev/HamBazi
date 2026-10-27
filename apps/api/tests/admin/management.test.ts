import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { adminFixture, ownerPin, password } from "./fixture.js";
import { generateAdminPassword } from "../../src/admin/application/management.js";
import { adminAccess, adminReadScope } from "../../src/admin/domain/access.js";
import type { AdminAction } from "@hambazi/validation";

async function fixture() {
  const f = await adminFixture();
  await f.enroll();
  const pending = await f.service.login({
    schemaVersion: 1,
    commandId: randomUUID(),
    username: "owner_fixture",
    password,
  });
  let token = (
    await f.service.pin(pending.token, { schemaVersion: 1, commandId: randomUUID(), pin: ownerPin })
  ).token;
  const management = f.management();
  async function execute(action: AdminAction) {
    const commandId = randomUUID();
    await management.request(token, {
      schemaVersion: 1,
      commandId,
      action,
      reasonCode: "ACCESS_ADMINISTRATION",
    });
    token = (
      await management.approve(token, commandId, {
        schemaVersion: 1,
        commandId: randomUUID(),
        password,
        pin: ownerPin,
        confirmed: true,
      })
    ).token;
    return management.execute(token, commandId);
  }
  return {
    f,
    management,
    execute,
    get token() {
      return token;
    },
  };
}
describe("phase two administrative authority", () => {
  it("subtracts a game deny from a global allow without removing unrelated games", () => {
    const principal = {
      operatorId: randomUUID(),
      isOwner: false,
      environment: "test",
      authorizationVersion: 1,
      policyRevision: 1,
      grants: [
        { permission: "rooms.view", environment: "test", gameIds: null, deny: false },
        { permission: "rooms.view", environment: "test", gameIds: ["kahroba"], deny: true },
      ],
    };
    expect(adminReadScope(principal, "rooms.view")).toEqual({ games: null, excluded: ["kahroba"] });
    expect(adminAccess(principal, "rooms.view", "kahroba")).toBe(false);
    expect(adminAccess(principal, "rooms.view", "coup")).toBe(true);
  });
  it("rejects phase-three user moderation even for OWNER and legacy approved/unknown operations", async () => {
    const t = await fixture(),
      id = randomUUID();
    for (const status of ["BANNED", "ACTIVE"] as const)
      await expect(
        t.management.request(t.token, {
          schemaVersion: 1,
          commandId: randomUUID(),
          reasonCode: "INCIDENT_RESPONSE",
          action: { operation: "USER_STATUS", targetId: id, expectedVersion: 0, status },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const commandId = randomUUID();
    await t.management.request(t.token, {
      schemaVersion: 1,
      commandId,
      reasonCode: "ACCESS_ADMINISTRATION",
      action: {
        operation: "ADMIN_CREATE",
        targetId: id,
        expectedVersion: 0,
        username: "deferred_fixture",
      },
    });
    const command = t.f.state.operations.get(commandId)!;
    command.action = {
      operation: "USER_STATUS",
      targetId: id,
      expectedVersion: 0,
      status: "BANNED",
    };
    for (const state of ["PENDING", "APPROVED", "UNKNOWN"] as const) {
      command.state = state;
      t.f.state.operations.set(commandId, structuredClone(command));
      await expect(t.management.renew(t.token, commandId)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        t.management.approve(t.token, commandId, {
          schemaVersion: 1,
          commandId: randomUUID(),
          password,
          pin: ownerPin,
          confirmed: true,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(t.management.execute(t.token, commandId)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    expect(
      t.f.state.audit.some((e) => e.commandId === commandId && e.event === "OPERATION_ADMITTED"),
    ).toBe(false);
    expect(t.f.state.operators.get(t.f.state.realm!.ownerId!)!.pinFailures).toBe(0);
  });
  it("generates unbiased 12-character credentials with all required classes", () => {
    for (let i = 0; i < 100; i++)
      expect(generateAdminPassword()).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])[A-Za-z0-9]{12}$/);
  });
  it("rotates reauthentication sessions, exposes a generated password once, and never persists it", async () => {
    const t = await fixture(),
      id = randomUUID(),
      before = t.token;
    const result = await t.execute({
      operation: "ADMIN_CREATE",
      targetId: id,
      expectedVersion: 0,
      username: "support_fixture",
    });
    expect(result.state).toBe("SUCCEEDED");
    expect(result.mode).toBe("OWNER_FINAL");
    expect(result.generatedPassword).toHaveLength(12);
    await expect(t.f.service.authenticate(before)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(
      (await t.management.execute(t.token, result.commandId)).generatedPassword,
    ).toBeUndefined();
    expect(JSON.stringify([...t.f.state.operations.values()])).not.toContain(
      result.generatedPassword!,
    );
    expect(JSON.stringify(t.f.state.audit)).not.toContain(result.generatedPassword!);
    const login = await t.f.service.login({
      schemaVersion: 1,
      commandId: randomUUID(),
      username: "support_fixture",
      password: result.generatedPassword,
    });
    expect(login.next).toBe("SIGNED_IN");
    await expect(t.management.directory(login.token)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await t.f.service.access(login.token)).permissions).toEqual([]);
  });
  it("protects OWNER and forbids role names or grants from manufacturing owner authority", async () => {
    const t = await fixture(),
      owner = t.f.state.realm!.ownerId!;
    await expect(
      t.management.request(t.token, {
        schemaVersion: 1,
        commandId: randomUUID(),
        reasonCode: "ACCESS_ADMINISTRATION",
        action: {
          operation: "ADMIN_STATUS",
          targetId: owner,
          expectedVersion: 1,
          status: "DISABLED",
        },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      t.management.request(t.token, {
        schemaVersion: 1,
        commandId: randomUUID(),
        reasonCode: "ACCESS_ADMINISTRATION",
        action: {
          operation: "ROLE_SAVE",
          targetId: randomUUID(),
          expectedVersion: 0,
          expectedMemberCount: 0,
          name: "Root",
          grants: [],
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const p = {
      operatorId: randomUUID(),
      isOwner: false,
      environment: "test",
      authorizationVersion: 1,
      policyRevision: 1,
      grants: [{ permission: "admins.manage", environment: "test", gameIds: null, deny: false }],
    };
    expect(adminAccess(p, "admins.manage")).toBe(false);
    expect(adminAccess({ ...p, isOwner: true }, "unregistered.future")).toBe(false);
  });
  it("applies role edits and individual denies to existing sessions immediately; reset revokes credentials", async () => {
    const t = await fixture(),
      id = randomUUID(),
      role = randomUUID();
    const created = await t.execute({
      operation: "ADMIN_CREATE",
      targetId: id,
      expectedVersion: 0,
      username: "operator_fixture",
    });
    const login = await t.f.service.login({
      schemaVersion: 1,
      commandId: randomUUID(),
      username: "operator_fixture",
      password: created.generatedPassword,
    });
    await t.execute({
      operation: "ROLE_SAVE",
      targetId: role,
      expectedVersion: 0,
      expectedMemberCount: 0,
      name: "Operator",
      grants: [
        { permission: "rooms.view", environment: "test", gameIds: ["kahroba"], deny: false },
      ],
    });
    await t.execute({
      operation: "ADMIN_ACCESS",
      targetId: id,
      expectedVersion: 1,
      roleIds: [role],
      grants: [],
    });
    expect((await t.f.service.access(login.token)).permissions).toContain("rooms.view");
    await t.execute({
      operation: "ROLE_SAVE",
      targetId: role,
      expectedVersion: 1,
      expectedMemberCount: 1,
      name: "Operator",
      grants: [],
    });
    expect((await t.f.service.access(login.token)).permissions).not.toContain("rooms.view");
    const reset = await t.execute({
      operation: "ADMIN_RESET_PASSWORD",
      targetId: id,
      expectedVersion: 2,
    });
    await expect(t.f.service.authenticate(login.token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      t.f.service.login({
        schemaVersion: 1,
        commandId: randomUUID(),
        username: "operator_fixture",
        password: created.generatedPassword,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(
      (
        await t.f.service.login({
          schemaVersion: 1,
          commandId: randomUUID(),
          username: "operator_fixture",
          password: reset.generatedPassword,
        })
      ).next,
    ).toBe("SIGNED_IN");
  });
  it("deletes role memberships and revokes sessions across the ordinary administrator lifecycle", async () => {
    const t = await fixture(),
      id = randomUUID(),
      roleId = randomUUID();
    const created = await t.execute({
      operation: "ADMIN_CREATE",
      targetId: id,
      expectedVersion: 0,
      username: "lifecycle_fixture",
    });
    const login = () =>
      t.f.service.login({
        schemaVersion: 1,
        commandId: randomUUID(),
        username: "lifecycle_fixture",
        password: created.generatedPassword,
      });
    await t.execute({
      operation: "ROLE_SAVE",
      targetId: roleId,
      expectedVersion: 0,
      expectedMemberCount: 0,
      name: "Lifecycle role",
      grants: [{ permission: "rooms.view", environment: "test", gameIds: null, deny: false }],
    });
    await t.execute({
      operation: "ADMIN_ACCESS",
      targetId: id,
      expectedVersion: 1,
      roleIds: [roleId],
      grants: [],
    });
    let session = await login();
    expect((await t.f.service.access(session.token)).permissions).toContain("rooms.view");
    await t.execute({
      operation: "ROLE_DELETE",
      targetId: roleId,
      expectedVersion: 1,
      expectedMemberCount: 1,
    });
    expect((await t.f.service.access(session.token)).permissions).not.toContain("rooms.view");
    await t.execute({ operation: "ADMIN_REVOKE_SESSIONS", targetId: id, expectedVersion: 2 });
    await expect(t.f.service.authenticate(session.token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    session = await login();
    await t.execute({
      operation: "ADMIN_STATUS",
      targetId: id,
      expectedVersion: 3,
      status: "DISABLED",
    });
    await expect(login()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(t.f.service.authenticate(session.token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await t.execute({
      operation: "ADMIN_STATUS",
      targetId: id,
      expectedVersion: 4,
      status: "ACTIVE",
    });
    session = await login();
    await t.execute({
      operation: "ADMIN_STATUS",
      targetId: id,
      expectedVersion: 5,
      status: "DELETED",
    });
    await expect(t.f.service.authenticate(session.token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      t.execute({ operation: "ADMIN_STATUS", targetId: id, expectedVersion: 6, status: "ACTIVE" }),
    ).rejects.toMatchObject({ code: "ADMIN_CONFLICT" });
    await expect(
      t.execute({
        operation: "ADMIN_CREATE",
        targetId: randomUUID(),
        expectedVersion: 0,
        username: "lifecycle_fixture",
      }),
    ).rejects.toMatchObject({ code: "ADMIN_CONFLICT" });
  });
  it("binds the role impact preview and invalidates approval when membership changes", async () => {
    const t = await fixture(),
      role = randomUUID(),
      id = randomUUID(),
      commandId = randomUUID();
    await t.execute({
      operation: "ADMIN_CREATE",
      targetId: id,
      expectedVersion: 0,
      username: "impact_fixture",
    });
    await t.execute({
      operation: "ROLE_SAVE",
      targetId: role,
      expectedVersion: 0,
      expectedMemberCount: 0,
      name: "Impact role",
      grants: [],
    });
    await t.execute({
      operation: "ADMIN_ACCESS",
      targetId: id,
      expectedVersion: 1,
      roleIds: [role],
      grants: [],
    });
    expect(
      (await t.management.directory(t.token)).roles.find((r) => r.id === role)!.memberCount,
    ).toBe(1);
    await expect(
      t.execute({
        operation: "ROLE_DELETE",
        targetId: role,
        expectedVersion: 1,
        expectedMemberCount: 0,
      }),
    ).rejects.toMatchObject({ code: "ADMIN_CONFLICT" });
    await t.management.request(t.token, {
      schemaVersion: 1,
      commandId,
      reasonCode: "ACCESS_ADMINISTRATION",
      action: {
        operation: "ROLE_DELETE",
        targetId: role,
        expectedVersion: 1,
        expectedMemberCount: 1,
      },
    });
    await t.execute({
      operation: "ADMIN_ACCESS",
      targetId: id,
      expectedVersion: 2,
      roleIds: [],
      grants: [],
    });
    await expect(
      t.management.approve(t.token, commandId, {
        schemaVersion: 1,
        commandId: randomUUID(),
        password,
        pin: ownerPin,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "ADMIN_CONFLICT" });
    expect(
      (await t.management.directory(t.token)).roles.find((r) => r.id === role)!.memberCount,
    ).toBe(0);
  });
  it("fails closed before effects on audit failure, stale revision, expiry and replayed approval", async () => {
    const t = await fixture(),
      id = randomUUID(),
      commandId = randomUUID();
    await t.management.request(t.token, {
      schemaVersion: 1,
      commandId,
      action: {
        operation: "ADMIN_CREATE",
        targetId: id,
        expectedVersion: 0,
        username: "audit_fixture",
      },
      reasonCode: "ACCESS_ADMINISTRATION",
    });
    const rotated = await t.management.approve(t.token, commandId, {
      schemaVersion: 1,
      commandId: randomUUID(),
      password,
      pin: ownerPin,
      confirmed: true,
    });
    await expect(
      t.management.approve(rotated.token, commandId, {
        schemaVersion: 1,
        commandId: randomUUID(),
        password,
        pin: ownerPin,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "ADMIN_CONFLICT" });
    t.f.failAudit();
    await expect(t.management.execute(rotated.token, commandId)).rejects.toThrow();
    expect(t.f.state.operators.has(id)).toBe(false);
    t.f.restoreAudit();
    t.f.clock.value += 60001;
    await expect(t.management.execute(rotated.token, commandId)).rejects.toMatchObject({
      code: "ADMIN_CONFLICT",
    });
    expect(t.f.state.operators.has(id)).toBe(false);
  });
  it("does not count wrong passwords as PIN failures; concurrent PIN failures lock only at three", async () => {
    const t = await fixture(),
      commandId = randomUUID();
    await t.management.request(t.token, {
      schemaVersion: 1,
      commandId,
      action: {
        operation: "ADMIN_CREATE",
        targetId: randomUUID(),
        expectedVersion: 0,
        username: "pin_fixture",
      },
      reasonCode: "ACCESS_ADMINISTRATION",
    });
    await expect(
      t.management.approve(t.token, commandId, {
        schemaVersion: 1,
        commandId: randomUUID(),
        password: password + "-wrong",
        pin: "654321",
        confirmed: true,
      }),
    ).rejects.toThrow();
    expect(t.f.state.operators.get(t.f.state.realm!.ownerId!)!.pinFailures).toBe(0);
    for (let i = 0; i < 3; i++)
      await expect(
        t.management.approve(t.token, commandId, {
          schemaVersion: 1,
          commandId: randomUUID(),
          password,
          pin: "654321",
          confirmed: true,
        }),
      ).rejects.toThrow();
    expect(t.f.state.operators.get(t.f.state.realm!.ownerId!)!.pinFailures).toBe(3);
    await expect(t.f.service.authenticate(t.token)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
  it("requires a distinct authorized approver, preserves the requester, and invalidates stale approvals", async () => {
    const t = await fixture(),
      actor = randomUUID(),
      approver = randomUUID();
    const first = await t.execute({
      operation: "ADMIN_CREATE",
      targetId: actor,
      expectedVersion: 0,
      username: "requester_fixture",
    });
    const second = await t.execute({
      operation: "ADMIN_CREATE",
      targetId: approver,
      expectedVersion: 0,
      username: "approver_fixture",
    });
    const grants = (permissions: string[]) =>
      permissions.map((permission) => ({
        permission,
        environment: "test",
        gameIds: null,
        deny: false,
      }));
    t.f.state.grants.set(actor, grants(["users.view", "users.edit", "users.approve"]));
    t.f.state.grants.set(approver, grants(["users.view", "users.approve"]));
    const login = async (username: string, password: string) =>
      t.f.service.login({ schemaVersion: 1, commandId: randomUUID(), username, password });
    const requester = await login("requester_fixture", first.generatedPassword!),
      reviewer = await login("approver_fixture", second.generatedPassword!);
    let effects = 0;
    const management = t.f.management({
      USER_DISPLAY_NAME: {
        target: async () => ({ gameId: null, version: 0 }),
        execute: async () => {
          effects++;
          return { code: "APPLIED" };
        },
        outcome: async () => null,
      },
    });
    const commandId = randomUUID();
    await management.request(requester.token, {
      schemaVersion: 1,
      commandId,
      action: {
        operation: "USER_DISPLAY_NAME",
        targetId: randomUUID(),
        expectedVersion: 0,
        displayName: "Synthetic correction",
      },
      reasonCode: "INCIDENT_RESPONSE",
    });
    await expect(
      management.approve(requester.token, commandId, {
        schemaVersion: 1,
        commandId: randomUUID(),
        password: first.generatedPassword,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await management.approve(reviewer.token, commandId, {
      schemaVersion: 1,
      commandId: randomUUID(),
      password: second.generatedPassword,
      confirmed: true,
    });
    expect(t.f.state.operations.get(commandId)!.mode).toBe("DUAL_CONTROL");
    expect(t.f.state.operations.get(commandId)!.actorId).toBe(actor);
    t.f.state.operators.get(approver)!.authorizationVersion++;
    await expect(management.execute(requester.token, commandId)).rejects.toMatchObject({
      code: "ADMIN_CONFLICT",
    });
    expect(effects).toBe(0);
  });
  it("keeps an ambiguous outcome UNKNOWN and reconciles a durable product receipt without another effect", async () => {
    const t = await fixture();
    let effects = 0,
      durable: { code: string } | null = null;
    const management = t.f.management({
      ROOM_CLOSE: {
        target: async () => ({ gameId: "kahroba", version: 0 }),
        execute: async () => {
          effects++;
          durable = { code: "APPLIED" };
          throw new Error("SYNTHETIC_RESPONSE_LOST");
        },
        outcome: async () => durable,
      },
    });
    const commandId = randomUUID();
    await management.request(t.token, {
      schemaVersion: 1,
      commandId,
      action: { operation: "ROOM_CLOSE", targetId: randomUUID(), expectedVersion: 0 },
      reasonCode: "MAINTENANCE",
    });
    const auth = await management.approve(t.token, commandId, {
      schemaVersion: 1,
      commandId: randomUUID(),
      password,
      pin: ownerPin,
      confirmed: true,
    });
    expect((await management.execute(auth.token, commandId)).state).toBe("UNKNOWN");
    expect((await management.status(auth.token, commandId)).state).toBe("SUCCEEDED");
    expect((await management.execute(auth.token, commandId)).state).toBe("SUCCEEDED");
    expect(effects).toBe(1);
    expect(
      t.f.state.audit.filter((e) => e.commandId === commandId && e.event === "OPERATION_SUCCEEDED"),
    ).toHaveLength(1);
  });
  it("renews an expired unknown operation under the same ID and requires fresh approval before another attempt", async () => {
    const t = await fixture();
    let attempts = 0,
      effect = false;
    const management = t.f.management({
      ROOM_CLOSE: {
        target: async () => ({ gameId: "kahroba", version: effect ? 1 : 0 }),
        outcome: async () => (effect ? { code: "APPLIED" } : null),
        execute: async () => {
          attempts++;
          if (attempts === 1) throw new Error("SYNTHETIC_PREWRITE_OUTAGE");
          effect = true;
          return { code: "APPLIED" };
        },
      },
    });
    const commandId = randomUUID(),
      action = { operation: "ROOM_CLOSE" as const, targetId: randomUUID(), expectedVersion: 0 };
    await management.request(t.token, {
      schemaVersion: 1,
      commandId,
      action,
      reasonCode: "MAINTENANCE",
    });
    let token = (
      await management.approve(t.token, commandId, {
        schemaVersion: 1,
        commandId: randomUUID(),
        password,
        pin: ownerPin,
        confirmed: true,
      })
    ).token;
    expect((await management.execute(token, commandId)).state).toBe("UNKNOWN");
    t.f.clock.value += 61000;
    await expect(management.execute(token, commandId)).rejects.toMatchObject({
      code: "ADMIN_CONFLICT",
    });
    expect(attempts).toBe(1);
    expect((await management.renew(token, commandId)).state).toBe("UNKNOWN");
    await expect(management.execute(token, commandId)).rejects.toMatchObject({
      code: "ADMIN_CONFLICT",
    });
    token = (
      await management.approve(token, commandId, {
        schemaVersion: 1,
        commandId: randomUUID(),
        password,
        pin: ownerPin,
        confirmed: true,
      })
    ).token;
    expect((await management.execute(token, commandId)).state).toBe("SUCCEEDED");
    expect(attempts).toBe(2);
    expect(
      (
        await management.request(token, {
          schemaVersion: 1,
          commandId,
          action,
          reasonCode: "MAINTENANCE",
        })
      ).state,
    ).toBe("SUCCEEDED");
  });
});

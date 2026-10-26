import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { adminFixture, password, ownerPin } from "./fixture.js";
const nextPassword = "SyntheticReplacementPassword456";
const login = (f: Awaited<ReturnType<typeof adminFixture>>, value = password) =>
  f.service.login({
    schemaVersion: 1,
    commandId: randomUUID(),
    username: "owner_fixture",
    password: value,
  });
const confirm = (f: Awaited<ReturnType<typeof adminFixture>>, token: string) =>
  f.service.pin(token, { schemaVersion: 1, commandId: randomUUID(), pin: ownerPin });
const change = () => ({
  schemaVersion: 1,
  commandId: randomUUID(),
  password,
  currentPin: ownerPin,
  newPassword: nextPassword,
});
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}

describe("OWNER password rotation", () => {
  it("requires full OWNER reauthentication, stores Argon2id and revokes all full/pending sessions", async () => {
    const f = await adminFixture();
    await f.enroll();
    const pending = await login(f);
    await expect(f.service.changePassword(pending.token, change())).rejects.toBeDefined();
    const full = await confirm(f, pending.token);
    const second = await confirm(f, (await login(f)).token);
    const stillPending = await login(f);
    await f.service.changePassword(full.token, change());
    for (const old of [full, second])
      await expect(f.service.access(old.token)).rejects.toBeDefined();
    await expect(confirm(f, stillPending.token)).rejects.toBeDefined();
    await expect(login(f)).rejects.toBeDefined();
    expect((await confirm(f, (await login(f, nextPassword)).token)).next).toBe("SIGNED_IN");
    const row = f.state.operators.get(f.state.realm!.ownerId!)!;
    expect(row.passwordVerifier).toMatch(/^\$argon2id\$/);
    expect(await f.crypto.verify(row.passwordVerifier, nextPassword, "password")).toBe(true);
    expect(row.pinFailures).toBe(0);
    expect(f.state.audit.filter((e) => e.event === "PASSWORD_CHANGED")).toHaveLength(1);
    for (const raw of [password, ownerPin, nextPassword])
      expect(JSON.stringify(f.state.audit)).not.toContain(raw);
  });
  it("never counts a wrong password as PIN failure; deduplicates wrong-PIN retries and locks at three", async () => {
    const f = await adminFixture();
    await f.enroll();
    const full = await confirm(f, (await login(f)).token);
    await expect(
      f.service.changePassword(full.token, { ...change(), password: "IncorrectSyntheticPassword" }),
    ).rejects.toBeDefined();
    expect(f.state.operators.get(f.state.realm!.ownerId!)!.pinFailures).toBe(0);
    const bad = { ...change(), currentPin: "999999" };
    for (let i = 0; i < 2; i++)
      await expect(f.service.changePassword(full.token, bad)).rejects.toBeDefined();
    expect(f.state.operators.get(f.state.realm!.ownerId!)!.pinFailures).toBe(1);
    for (let i = 0; i < 2; i++)
      await expect(
        f.service.changePassword(full.token, { ...bad, commandId: randomUUID() }),
      ).rejects.toBeDefined();
    const row = f.state.operators.get(f.state.realm!.ownerId!)!;
    expect(row.pinFailures).toBe(3);
    expect(row.lockedAt).not.toBeNull();
    await expect(login(f)).rejects.toBeDefined();
  });
  it("rolls back rotation and version changes when audit is unavailable", async () => {
    const f = await adminFixture();
    await f.enroll();
    const full = await confirm(f, (await login(f)).token);
    const before = structuredClone(f.state.operators.get(f.state.realm!.ownerId!)!);
    f.failAudit();
    await expect(f.service.changePassword(full.token, change())).rejects.toBeDefined();
    f.restoreAudit();
    expect(f.state.operators.get(before.id)).toEqual(before);
    expect((await login(f)).next).toBe("PIN_REQUIRED");
  });
  it("fences a verified password change if private recovery commits before it", async () => {
    const f = await adminFixture();
    await f.enroll();
    const full = await confirm(f, (await login(f)).token);
    const entered = latch(),
      resume = latch(),
      atomic = f.repository.atomic;
    let calls = 0;
    f.repository.atomic = async (operation) => {
      if (++calls === 3) {
        entered.release();
        await resume.promise;
      }
      return atomic(operation);
    };
    const rotating = f.service.changePassword(full.token, change());
    await entered.promise;
    await f.provisioning.run(
      {
        schemaVersion: 1,
        commandId: randomUUID(),
        username: "owner_fixture",
        pin: ownerPin,
        confirmed: true,
        reasonCode: "OWNER_PIN_RECOVERY",
      },
      "synthetic-verified-authority",
    );
    resume.release();
    await expect(rotating).rejects.toBeDefined();
    expect((await login(f)).next).toBe("PIN_REQUIRED");
    expect(f.state.audit.filter((e) => e.event === "PASSWORD_CHANGED")).toHaveLength(0);
  });
  it("rejects an old password login verified before the rotation commit", async () => {
    const f = await adminFixture();
    await f.enroll();
    const full = await confirm(f, (await login(f)).token);
    const entered = latch(),
      resume = latch(),
      atomic = f.repository.atomic;
    let calls = 0;
    f.repository.atomic = async (operation) => {
      if (++calls === 1) {
        entered.release();
        await resume.promise;
      }
      return atomic(operation);
    };
    const signingIn = login(f);
    await entered.promise;
    await f.service.changePassword(full.token, change());
    resume.release();
    await expect(signingIn).rejects.toBeDefined();
    expect((await login(f, nextPassword)).next).toBe("PIN_REQUIRED");
  });
});

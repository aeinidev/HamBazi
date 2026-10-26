import assert from "node:assert/strict";
import { mkdir, writeFile, symlink, link, chmod, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  readPrivate,
  writePrivateJson,
  lockPrivate,
  appendCeremonyAudit,
  requireCeremonySafety,
} from "/fixture/module.mjs";

const root = "/opt/hambazi-fixture";
await mkdir(root, { mode: 0o700 });
await writePrivateJson(root + "/state.json", { pending: true });
assert.deepEqual(JSON.parse((await readPrivate(root + "/state.json")).toString()), {
  pending: true,
});
await writeFile(root + "/source", "synthetic-only", { mode: 0o600 });
await symlink(root + "/source", root + "/symlink");
await assert.rejects(readPrivate(root + "/symlink"));
await link(root + "/source", root + "/hardlink");
await assert.rejects(readPrivate(root + "/hardlink"));
await writeFile(root + "/readable", "synthetic-only", { mode: 0o640 });
await assert.rejects(readPrivate(root + "/readable"));
await mkdir(root + "/unsafe", { mode: 0o700 });
await chmod(root + "/unsafe", 0o777);
await writeFile(root + "/unsafe/file", "synthetic-only", { mode: 0o600 });
await assert.rejects(readPrivate(root + "/unsafe/file"));
await assert.rejects(readPrivate(root + "/../hambazi-fixture/state.json"));
await assert.rejects(readPrivate(root + "/state.json", 1));
const unlock = await lockPrivate(root + "/lock");
await assert.rejects(lockPrivate(root + "/lock"));
await unlock();
const unlockAgain = await lockPrivate(root + "/lock");
await unlockAgain();
await appendCeremonyAudit(root + "/audit", {
  commandId: randomUUID(),
  action: "bootstrap",
  outcome: "STARTED",
  password: "must-never-be-logged",
});
assert.equal((await readFile(root + "/audit", "utf8")).includes("must-never-be-logged"), false);
await chmod(root + "/audit", 0o644);
await assert.rejects(
  appendCeremonyAudit(root + "/audit", {
    commandId: randomUUID(),
    action: "recover",
    outcome: "DENIED",
  }),
);
await mkdir("/opt/hambazi/admin/security", { recursive: true, mode: 0o700 });
await mkdir("/opt/hambazi/security", { mode: 0o700 });
await mkdir("/var/www/hambazi-admin", { mode: 0o700 });
for (const path of ["/opt/hambazi/security/state.json", "/opt/hambazi/admin/security/state.json"])
  await writePrivateJson(path, { deadlineUTC: new Date(Date.now() + 600000).toISOString() });
await requireCeremonySafety();
await writePrivateJson("/opt/hambazi/security/state.json", {
  deadlineUTC: new Date(0).toISOString(),
});
await assert.rejects(requireCeremonySafety());
await writePrivateJson("/opt/hambazi/security/state.json", {
  deadlineUTC: new Date(Date.now() + 600000).toISOString(),
});
await writeFile("/var/www/hambazi-admin/maintenance", "");
await assert.rejects(requireCeremonySafety());

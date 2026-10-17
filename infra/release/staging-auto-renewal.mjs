import { readFile, writeFile, rename, mkdir, rm, lstat, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify, isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { pathToFileURL } from "node:url";

const root = "/opt/hambazi-staging/private/execution-20261008";
const installed = root + "/automatic-renewal-20261013";
const timerFile =
  "/etc/systemd/system/hambazi-staging-advisory-expiry.timer.d/normal-scans-20261009.conf";
const timerName = "hambazi-staging-advisory-expiry.timer";
const roles = [
  "api",
  "bot",
  "worker",
  "web",
  "ingress",
  "acme",
  "postgres-staging",
  "redis-staging",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const check = (value) => {
  if (!value) throw new Error("STAGING_AUTO_RENEWAL_BLOCKED");
};

/** Normal policy only. A new download of old advisories cannot extend their age. */
export function normalRenewalExpiry(report, pins, now) {
  check(Number.isFinite(now) && report?.ok === true && pins.length === 8);
  check(new Set(pins.map((p) => p.role)).size === 8);
  check(roles.every((role) => pins.some((p) => p.role === role)));
  check(report.images?.length === 8 && new Set(report.images.map((p) => p.role)).size === 8);
  for (const pin of pins) {
    const result = report.images.find((r) => r.role === pin.role);
    check(
      result?.image === pin.image &&
        result.ok === true &&
        result.counts?.high === 0 &&
        result.counts?.critical === 0 &&
        result.counts?.unknown === 0,
    );
  }
  const times = [report.database?.updatedAt, report.database?.downloadedAt].map(Date.parse);
  check(times.every((t) => Number.isFinite(t) && t <= now + 300000 && now - t < 86400000));
  return new Date(Math.floor((Math.min(...times) + 86400000) / 1000) * 1000).toISOString();
}

/** Recheck authority/runtime after scanning; never start apps or reopen routes. */
export async function automaticRenewal(deps) {
  const before = await deps.verify();
  check(Date.parse(before.deadlineUTC) - deps.now() > 15 * 60000);
  const report = await deps.scan();
  const after = await deps.verify();
  check(isDeepStrictEqual(before, after));
  check(Date.parse(after.deadlineUTC) - deps.now() > 15 * 60000);
  const expiryUTC = normalRenewalExpiry(report, deps.pins, deps.now());
  if (Date.parse(expiryUTC) <= Date.parse(after.deadlineUTC))
    return { result: "unchanged", expiryUTC: after.deadlineUTC };
  await deps.commit(report, expiryUTC, after);
  return { result: "renewed", expiryUTC };
}

async function privateBytes(path, rootOwned = true) {
  const stat = await lstat(path);
  check(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      (stat.mode & 0o077) === 0 &&
      (!rootOwned || stat.uid === 0),
  );
  return readFile(path);
}
async function privateJson(path, rootOwned = true) {
  return JSON.parse(await privateBytes(path, rootOwned));
}
async function atomicJson(path, value) {
  const next = path + ".next-" + randomUUID();
  await writeFile(next, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(next, path);
}
async function run(command, args, timeout = 15000) {
  return (
    await promisify(execFile)(command, args, {
      timeout,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024 * 1024,
      env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/root", LANG: "C.UTF-8" },
    })
  ).stdout;
}
async function timerSnapshot() {
  const bytes = await readFile(timerFile);
  const match =
    /^\[Timer\]\nOnCalendar=\nOnCalendar=(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC\n$/.exec(
      bytes.toString(),
    );
  check(match);
  const deadlineUTC = match[1] + "T" + match[2] + ".000Z";
  check(Number.isFinite(Date.parse(deadlineUTC)));
  const text = await run("systemctl", [
    "show",
    timerName,
    "-p",
    "NextElapseUSecRealtime",
    "-p",
    "ActiveState",
    "-p",
    "UnitFileState",
    "-p",
    "Persistent",
    "-p",
    "AccuracyUSec",
    "-p",
    "RandomizedDelayUSec",
    "-p",
    "Unit",
  ]);
  for (const field of [
    "ActiveState=active",
    "UnitFileState=enabled",
    "Persistent=yes",
    "AccuracyUSec=1s",
    "RandomizedDelayUSec=0",
    "Unit=hambazi-staging-advisory-expiry.service",
  ])
    check(text.split("\n").includes(field));
  const next = text.split("\n").find((line) => line.startsWith("NextElapseUSecRealtime="));
  check(next?.includes(match[1] + " " + match[2] + " UTC"));
  return { deadlineUTC, timerSha256: digest(bytes) };
}

async function main() {
  let stage = "policy",
    attempt,
    scannedEvidence;
  try {
    check(process.argv.length === 3 && ["--run", "--check"].includes(process.argv[2]));
    const policyBytes = await privateBytes(installed + "/policy.json");
    const policy = JSON.parse(policyBytes);
    const authority = await privateJson(installed + "/control.json");
    check(authority.enabled === true && authority.policySha256 === digest(policyBytes));
    check(policy.schemaVersion === 1 && policy.profile === "restricted-staging-auto-normal-v1");
    check(
      policy.targetAddress === "185.110.191.104" &&
        policy.dockerDaemonId === "342f251a-9e56-4353-af12-a32429b7a2e7",
    );
    check(policy.productionReleaseApproved === false && policy.untilOwnerRevocation === true);
    check(policy.images.length === 8 && new Set(policy.images.map((p) => p.role)).size === 8);
    for (const [path, hash] of Object.entries(policy.implementationHashes))
      check(digest(await readFile(path)) === hash);
    const scanner = await import(pathToFileURL(policy.scannerModule));
    const operator = await import(pathToFileURL(policy.operatorModule));
    async function verify() {
      check(isDeepStrictEqual(await privateJson(installed + "/control.json"), authority));
      check(digest(await privateBytes(installed + "/policy.json")) === authority.policySha256);
      check(
        Object.values(networkInterfaces())
          .flat()
          .some((n) => n?.address === policy.targetAddress),
      );
      check(
        (await run("docker", ["info", "--format", "{{.ID}}"])).trim() === policy.dockerDaemonId,
      );
      for (const [path, hash] of Object.entries(policy.controls)) {
        const stat = await lstat(path);
        check(stat.isFile() && !stat.isSymbolicLink());
        if (policy.privateControlPaths.includes(path)) check((stat.mode & 0o077) === 0);
        check(digest(await readFile(path)) === hash);
      }
      for (const pin of policy.images) {
        const image = JSON.parse(await run("docker", ["image", "inspect", pin.image]))[0];
        check(image.Id === pin.image.split("@")[1] && image.Architecture === "amd64");
      }
      const owner = await privateJson(policy.ownerFile, false),
        tester = await privateJson(policy.testerFile, false);
      check(
        owner.telegramUserIds.length === 1 &&
          tester.telegramUserIds.length === 1 &&
          owner.telegramUserIds[0] !== tester.telegramUserIds[0],
      );
      for (const expected of policy.containers) {
        const c = JSON.parse(await run("docker", ["inspect", expected.name]))[0];
        check(
          c.Id === expected.id &&
            c.Config.Image === expected.image &&
            c.Image === expected.image.split("@")[1],
        );
        check(c.State.Running && !c.State.OOMKilled);
        check(isDeepStrictEqual(c.HostConfig.PortBindings, expected.ports));
        if (expected.role) {
          check(c.Config.User === "1000:1000" && c.HostConfig.LogConfig.Type === "local");
          check(c.State.Health?.Status === "healthy");
          if (["api", "bot"].includes(expected.role))
            for (const [source, destination] of [
              [policy.ownerFile, "/run/hambazi/owner-admission.json"],
              [policy.testerFile, "/run/hambazi/staging-test-admission.json"],
            ])
              check(
                c.Mounts.some((m) => m.Source === source && m.Destination === destination && !m.RW),
              );
          for (const action of ["live", "ready"])
            check(
              (await operator.inspectOperator(policy.preparedDirectory, expected.role, action))
                .httpStatus === 200,
            );
        }
      }
      check(
        (await run("systemctl", ["is-active", "hambazi-staging-firewall.service"])).trim() ===
          "active",
      );
      const current = await timerSnapshot();
      const state = await privateJson(installed + "/state.json");
      // A killed process may have installed a fully proven deadline before saving state.
      let pending;
      try {
        pending = await privateJson(installed + "/pending.json");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (pending) {
        const expires = normalRenewalExpiry(pending.report, policy.images, Date.now());
        check(expires === pending.next.deadlineUTC);
        check(isDeepStrictEqual(state, pending.previous) || isDeepStrictEqual(state, pending.next));
        if (isDeepStrictEqual(current, pending.next)) {
          if (process.argv[2] === "--run")
            await atomicJson(installed + "/state.json", pending.next);
        } else check(isDeepStrictEqual(current, pending.previous));
        if (process.argv[2] === "--run") await rm(installed + "/pending.json");
      } else check(isDeepStrictEqual(current, state));
      return current;
    }
    stage = "runtime";
    if (process.argv[2] === "--check") {
      const state = await verify();
      console.info(
        JSON.stringify({ event: "staging.auto-renewal.checked", expiryUTC: state.deadlineUTC }),
      );
      return;
    }
    const deps = {
      now: Date.now,
      pins: policy.images,
      verify,
      async scan() {
        stage = "scan";
        await scanner.verifyTool(policy.scannerBinary, "trivy");
        // The flock/systemd unit owns these disposable caches, including interrupted runs.
        for (const name of await readdir(installed)) {
          if (!/^attempt-\d{13}$/.test(name)) continue;
          const path = installed + "/" + name;
          const stat = await lstat(path);
          check(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 0);
          await rm(path, { recursive: true });
        }
        attempt = installed + "/attempt-" + Date.now();
        await mkdir(attempt, { mode: 0o700 });
        const cache = attempt + "/cache";
        await mkdir(cache, { mode: 0o700 });
        await run(
          policy.scannerBinary,
          ["image", "--download-db-only", "--cache-dir", cache, "--quiet"],
          180000,
        );
        const database = scanner.assertFreshDatabase(
          JSON.parse(await readFile(cache + "/db/metadata.json")),
        );
        const images = [];
        for (const pin of policy.images) {
          const path = attempt + "/raw.json";
          await run(
            policy.scannerBinary,
            [
              "image",
              "--scanners=vuln",
              "--image-src=docker",
              "--format=json",
              "--output",
              path,
              "--exit-code=0",
              "--cache-dir",
              cache,
              "--quiet",
              pin.image,
            ],
            180000,
          );
          images.push({
            role: pin.role,
            ...scanner.assessImage(JSON.parse(await readFile(path)), pin.image),
          });
          await rm(path);
        }
        const report = {
          schemaVersion: 1,
          scannedAt: new Date().toISOString(),
          database,
          images,
          ok: images.every((i) => i.ok),
        };
        const evidencePath = installed + "/reports/" + Date.now() + ".json";
        await writeFile(evidencePath, JSON.stringify(report, null, 2) + "\n", {
          mode: 0o600,
          flag: "wx",
        });
        scannedEvidence = { path: evidencePath, sha256: digest(await readFile(evidencePath)) };
        const reports = (await readdir(installed + "/reports"))
          .filter((name) => /^\d{13}\.json$/.test(name))
          .sort();
        for (const name of reports.slice(0, Math.max(0, reports.length - 168))) {
          const path = installed + "/reports/" + name;
          await privateBytes(path);
          await rm(path);
        }
        // Keep failed reports too. Scanner cache/raw material belongs only to this attempt.
        stage = "recheck";
        return report;
      },
      async commit(report, expiryUTC, previous) {
        stage = "deadline";
        check(isDeepStrictEqual(await verify(), previous));
        check(Date.parse(previous.deadlineUTC) - Date.now() > 15 * 60000);
        check(normalRenewalExpiry(report, policy.images, Date.now()) === expiryUTC);
        const nextBytes =
          "[Timer]\nOnCalendar=\nOnCalendar=" +
          expiryUTC.slice(0, 10) +
          " " +
          expiryUTC.slice(11, 19) +
          " UTC\n";
        const next = { deadlineUTC: expiryUTC, timerSha256: digest(nextBytes) };
        await atomicJson(installed + "/pending.json", { previous, next, report });
        const path = timerFile + ".auto-next-" + randomUUID();
        await writeFile(path, nextBytes, { mode: 0o644, flag: "wx" });
        // Revoke first when stopping automation: this check fences an in-flight scan.
        check(isDeepStrictEqual(await privateJson(installed + "/control.json"), authority));
        check(isDeepStrictEqual(await timerSnapshot(), previous));
        await rename(path, timerFile);
        await run("systemctl", ["daemon-reload"]);
        await run("systemctl", ["restart", timerName]);
        check(isDeepStrictEqual(await timerSnapshot(), next));
        await atomicJson(installed + "/state.json", next);
        await rm(installed + "/pending.json");
      },
    };
    const result = await automaticRenewal(deps);
    await atomicJson(installed + "/last-run.json", {
      checkedAt: new Date().toISOString(),
      ...result,
      scanEvidence: scannedEvidence,
      productionReleaseApproved: false,
    });
    console.info(
      JSON.stringify({
        event: "staging.auto-renewal." + result.result,
        expiryUTC: result.expiryUTC,
      }),
    );
  } catch {
    console.error(JSON.stringify({ event: "staging.auto-renewal.blocked", stage }));
    process.exitCode = 1;
  } finally {
    if (attempt) {
      try {
        await rm(attempt, { recursive: true, force: true });
      } catch {
        console.error(JSON.stringify({ event: "staging.auto-renewal.blocked", stage: "cleanup" }));
        process.exitCode = 1;
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

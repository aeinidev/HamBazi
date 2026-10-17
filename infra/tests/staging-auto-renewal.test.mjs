import { expect, it, vi } from "vitest";
import { automaticRenewal, normalRenewalExpiry } from "../release/staging-auto-renewal.mjs";

const now = Date.parse("2026-10-13T20:00:00Z");
const names = [
  "api",
  "bot",
  "worker",
  "web",
  "ingress",
  "acme",
  "postgres-staging",
  "redis-staging",
];
const pins = names.map((role) => ({ role, image: role + "@sha256:" + "a".repeat(64) }));
const report = () => ({
  ok: true,
  database: { updatedAt: "2026-10-13T19:00:00.999Z", downloadedAt: "2026-10-13T19:30:00Z" },
  images: pins.map((pin) => ({ ...pin, ok: true, counts: { high: 0, critical: 0, unknown: 0 } })),
});
function fixture() {
  return {
    pins,
    now: vi.fn(() => now),
    verify: vi.fn(async () => ({ deadlineUTC: "2026-10-14T10:00:00.000Z", timerSha256: "old" })),
    scan: vi.fn(async () => report()),
    commit: vi.fn(async () => {}),
  };
}

it("uses the earlier genuine metadata timestamp plus 24h, rounded down", () => {
  expect(normalRenewalExpiry(report(), pins, now)).toBe("2026-10-14T19:00:00.000Z");
  const earlierDownload = report();
  earlierDownload.database.downloadedAt = "2026-10-13T18:00:00Z";
  expect(normalRenewalExpiry(earlierDownload, pins, now)).toBe("2026-10-14T18:00:00.000Z");
});

it("rejects stale/future/invalid metadata even with a new download", () => {
  for (const updatedAt of ["2026-10-12T20:00:00Z", "2026-10-14T00:00:00Z", "invalid"]) {
    const bad = report();
    bad.database.updatedAt = updatedAt;
    expect(() => normalRenewalExpiry(bad, pins, now)).toThrow();
  }
});

it("requires all eight unique exact-image results and blocks every forbidden severity", () => {
  for (const mutate of [
    (r) => {
      r.images.pop();
    },
    (r) => {
      r.images[1] = r.images[0];
    },
    (r) => {
      r.images[0].image = "other";
    },
    (r) => {
      r.images[0].ok = false;
    },
    ...["high", "critical", "unknown"].map((severity) => (r) => {
      r.images[0].counts[severity] = 1;
    }),
  ]) {
    const bad = report();
    mutate(bad);
    expect(() => normalRenewalExpiry(bad, pins, now)).toThrow();
  }
});

it("commits only after successful scans and a second identical runtime/authority check", async () => {
  const deps = fixture();
  expect(await automaticRenewal(deps)).toEqual({
    result: "renewed",
    expiryUTC: "2026-10-14T19:00:00.000Z",
  });
  expect(deps.verify).toHaveBeenCalledTimes(2);
  expect(deps.commit).toHaveBeenCalledOnce();
});

it("cannot extend the deadline on scanner/download failure or a blocked image", async () => {
  for (const kind of ["download", "findings"]) {
    const deps = fixture();
    deps.scan.mockImplementation(async () => {
      if (kind === "download") throw new Error("scanner unavailable");
      const bad = report();
      bad.images[0].counts.high = 1;
      return bad;
    });
    await expect(automaticRenewal(deps)).rejects.toThrow();
    expect(deps.commit).not.toHaveBeenCalled();
  }
});

it("cannot renew after revocation or drift during an in-flight scan", async () => {
  for (const kind of ["revoked", "drift"]) {
    const deps = fixture();
    deps.verify.mockImplementationOnce(async () => ({
      deadlineUTC: "2026-10-14T10:00:00.000Z",
      timerSha256: "old",
    }));
    deps.verify.mockImplementationOnce(async () => {
      if (kind === "revoked") throw new Error("disabled");
      return { deadlineUTC: "2026-10-14T10:00:00.000Z", timerSha256: "changed" };
    });
    await expect(automaticRenewal(deps)).rejects.toThrow();
    expect(deps.commit).not.toHaveBeenCalled();
  }
});

it("leaves the existing hard expiry unchanged when advisories have not advanced", async () => {
  const deps = fixture();
  deps.verify.mockImplementation(async () => ({
    deadlineUTC: "2026-10-14T19:00:00.000Z",
    timerSha256: "old",
  }));
  expect(await automaticRenewal(deps)).toEqual({
    result: "unchanged",
    expiryUTC: "2026-10-14T19:00:00.000Z",
  });
  expect(deps.commit).not.toHaveBeenCalled();
});

it("does not race containment or resurrect already expired services", async () => {
  const deps = fixture();
  deps.verify.mockImplementation(async () => ({
    deadlineUTC: "2026-10-13T20:10:00.000Z",
    timerSha256: "old",
  }));
  await expect(automaticRenewal(deps)).rejects.toThrow();
  expect(deps.scan).not.toHaveBeenCalled();
  expect(deps.commit).not.toHaveBeenCalled();
  const elapsed = fixture();
  elapsed.now
    .mockImplementationOnce(() => now)
    .mockImplementation(() => Date.parse("2026-10-14T10:00:00Z"));
  await expect(automaticRenewal(elapsed)).rejects.toThrow();
  expect(elapsed.commit).not.toHaveBeenCalled();
});

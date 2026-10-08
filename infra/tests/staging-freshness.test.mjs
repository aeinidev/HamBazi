import { expect, it } from "vitest";
import { assertFreshDatabase } from "../scripts/security-scan.mjs";
import { validateStagingFreshnessTarget } from "../release/staging-freshness.mjs";
const now = Date.parse("2026-10-08T08:20:00Z");
const target = {
  address: "185.110.191.104",
  dockerDaemonId: "342f251a-9e56-4353-af12-a32429b7a2e7",
  ownerAdmissionProfile: "telegram-owner-only-v1",
};
const metadata = {
  Version: 2,
  UpdatedAt: "2026-10-07T07:38:55.515Z",
  DownloadedAt: "2026-10-08T08:00:00Z",
};
it("keeps default CI at 24h and explicitly records the bounded target exception", () => {
  expect(() => assertFreshDatabase(metadata, now)).toThrow();
  const context = validateStagingFreshnessTarget(target, now);
  expect(assertFreshDatabase(metadata, now, context)).toMatchObject({
    updatedAt: metadata.UpdatedAt,
    standard24HourGatePassed: false,
    freshnessException: { maximumAgeHours: 48 },
  });
});
it("denies a foreign target, altered context, expired approval and stale/future/malformed DB", () => {
  const context = validateStagingFreshnessTarget(target, now);
  for (const change of [
    { address: "127.0.0.1" },
    { dockerDaemonId: "other" },
    { ownerAdmissionProfile: "public" },
  ])
    expect(() => validateStagingFreshnessTarget({ ...target, ...change }, now)).toThrow();
  expect(() => assertFreshDatabase(metadata, now, { ...context, maximumAgeHours: 72 })).toThrow();
  expect(() => assertFreshDatabase(metadata, Date.parse(context.expiresAt), context)).toThrow();
  for (const change of [
    { UpdatedAt: "2026-10-06T07:00:00Z" },
    { DownloadedAt: "2026-10-06T07:00:00Z" },
    { UpdatedAt: "2026-10-09T08:20:00Z" },
    { Version: 1 },
    { UpdatedAt: "bad" },
  ])
    expect(() => assertFreshDatabase({ ...metadata, ...change }, now, context)).toThrow();
});

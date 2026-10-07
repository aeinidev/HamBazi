import { expect, it } from "vitest";
import {
  capacityProfile,
  capacityConnectionProfile,
  capacityFixtureLimits,
  capacityResources,
  capacityDriverBudgetSeconds,
  capacityHttpRetryAllowed,
  latencyGates,
  normalCapacityGates,
  capacityPopulationGates,
  latencyHistogram,
  reconcileMatch,
} from "../scripts/capacity-model.mjs";

it("honors retryability and repeats only unavailable reads or stable public intents within budget", () => {
  const body = { commandId: "11111111-1111-4111-8111-111111111111" };
  expect(capacityHttpRetryAllowed(503, 0, undefined, false, true)).toBe(true);
  expect(capacityHttpRetryAllowed(503, 2, body, false, true)).toBe(true);
  expect(capacityHttpRetryAllowed(503, 0, body)).toBe(false);
  expect(capacityHttpRetryAllowed(503, 0, body, false, false)).toBe(false);
  expect(capacityHttpRetryAllowed(503, 3, body, false, true)).toBe(false);
  expect(capacityHttpRetryAllowed(503, 0, body, true, true)).toBe(false);
  expect(capacityHttpRetryAllowed(503, 0, {}, false, true)).toBe(false);
  expect(capacityHttpRetryAllowed(503, 0, { commandId: "invalid" }, false, true)).toBe(false);
  expect(
    capacityHttpRetryAllowed(
      503,
      0,
      { commandId: "------------------------------------" },
      false,
      true,
    ),
  ).toBe(false);
  expect(capacityHttpRetryAllowed(503, -1, body, false, true)).toBe(false);
  for (const status of [400, 401, 403, 404, 409, 429, 500])
    expect(capacityHttpRetryAllowed(status, 0, body, false, true)).toBe(false);
});

it("rejects missing resource signals and unapproved telemetry without echoing it", () => {
  const api = {
    rssBytes: 100,
    heapUsedBytes: 50,
    eventLoopP99Ms: 0.5,
    eventLoopMaxMs: 1,
    cpuUserMicros: 10,
    cpuSystemMicros: 5,
  };
  const db = { numbackends: 2, xact_commit: "10", xact_rollback: "0", deadlocks: "0" };
  const info =
    "used_memory:100\r\nconnected_clients:2\r\ntotal_commands_processed:42\r\nrejected_connections:0\r\n";
  expect(capacityResources(api, db, info)).toMatchObject({
    db: { xact_commit: 10 },
    redis: { commands: 42, rejectedConnections: 0 },
  });
  expect(() => capacityResources(api, db, info.replace("rejected_connections:0\r\n", ""))).toThrow(
    "CAPACITY_METRICS_INVALID",
  );
  expect(() => capacityResources(api, { ...db, deadlocks: null }, info)).toThrow(
    "CAPACITY_METRICS_INVALID",
  );
  const privateInput = "PRIVATE_CAPACITY_METRIC_CANARY";
  try {
    capacityResources({ ...api, privateInput }, db, info);
    throw new Error("EXPECTED_REJECTION");
  } catch (error) {
    expect(error.message).toBe("CAPACITY_METRICS_INVALID");
    expect(error.message.includes(privateInput)).toBe(false);
  }
});

it("requires explicit peaks and preserves the full two-hour gate", () => {
  const peak = {
    peakCcu: 4,
    peakMatches: 2,
    peakCommandsPerSecond: 2,
    targets: {
      restP95Ms: 500,
      commandP95Ms: 300,
      dispatchToAllRecipientsP95Ms: 500,
      reconnectSuccessPercent: 95,
      reconnectP95Ms: 5000,
    },
  };
  expect(capacityProfile(peak)).toMatchObject({
    ccu: 8,
    matches: 4,
    commandsPerSecond: 4,
    normalCcu: 4,
    normalMatches: 2,
    normalCommandsPerSecond: 2,
    soakSeconds: 7200,
  });
  for (const input of [
    {},
    { ...peak, targets: undefined },
    { ...peak, peakMatches: 3 },
    { ...peak, peakCcu: 1001 },
    { ...peak, soakSeconds: 7199 },
    { ...peak, approval: true },
  ])
    expect(() => capacityProfile(input)).toThrow();
  expect(capacityProfile({ ...peak, soakSeconds: 10 }, true).smoke).toBe(true);
  expect(capacityProfile({ ...peak, peakCcu: 1000 }).ccu).toBe(2000);
});

it("bounds connection probes independently of unknown Match and command peaks", () => {
  const profile = capacityConnectionProfile(2000);
  expect(profile).toMatchObject({ connectionOnly: true, ccu: 2000, matches: 0, soakSeconds: 30 });
  expect(profile.peakCommandsPerSecond).toBeUndefined();
  expect(profile.targets).toBeUndefined();
  expect(capacityFixtureLimits(2000)).toMatchObject({
    maxConnections: 4000,
    maxPendingTotal: 8000,
    socketEventsPerMinute: 360000,
  });
  expect(capacityFixtureLimits(4).maxConnections).toBe(100);
  for (const value of [0, -1, 2001, 1.5, NaN, "2000"])
    expect(() => capacityConnectionProfile(value)).toThrow("CAPACITY_FIXTURE_LIMIT");
});

it("budgets both connection holds and scales full setup/reconciliation without shortening soak", () => {
  expect(capacityDriverBudgetSeconds(capacityConnectionProfile(2000))).toBe(660);
  const profile = capacityProfile({
    peakCcu: 1000,
    peakMatches: 200,
    peakCommandsPerSecond: 50,
    targets: {
      restP95Ms: 300,
      commandP95Ms: 300,
      dispatchToAllRecipientsP95Ms: 500,
      reconnectSuccessPercent: 99,
      reconnectP95Ms: 5000,
    },
  });
  expect(capacityDriverBudgetSeconds(profile)).toBe(12460);
  expect(profile.soakSeconds).toBe(7200);
});

it("fails latency gates with empty samples or insufficient reconnect success", () => {
  const latency = {
    rest: { count: 100, p95UpperMs: 500 },
    command: { count: 100, p95UpperMs: 300 },
    dispatchToAllRecipients: { count: 100, p95UpperMs: 500 },
  };
  const targets = {
    restP95Ms: 500,
    commandP95Ms: 300,
    dispatchToAllRecipientsP95Ms: 500,
    reconnectSuccessPercent: 95,
    reconnectP95Ms: 5000,
  };
  const counts = { reconnectAttempts: 100, reconnectSuccess: 95 };
  const reconnect = { count: 95, p95UpperMs: 5000 };
  expect(latencyGates(latency, counts, targets, reconnect)).toBe(true);
  expect(latencyGates(latency, { ...counts, reconnectSuccess: 94 }, targets, reconnect)).toBe(
    false,
  );
  expect(latencyGates(latency, counts, targets, { count: 95, p95UpperMs: 5001 })).toBe(false);
  expect(latencyGates(latency, counts, targets, { count: 0, p95UpperMs: null })).toBe(false);
  expect(
    latencyGates(
      { ...latency, command: { count: 0, p95UpperMs: null } },
      counts,
      targets,
      reconnect,
    ),
  ).toBe(false);
  expect(
    latencyGates(
      { ...latency, command: { count: 100, p95UpperMs: 500 } },
      counts,
      targets,
      reconnect,
    ),
  ).toBe(false);
  expect(latencyGates(latency, counts, undefined)).toBeNull();
});

it("gates normal-load SLOs independently of stress latency and keeps reconnect success separate from p95", () => {
  const targets = {
    restP95Ms: 300,
    commandP95Ms: 300,
    dispatchToAllRecipientsP95Ms: 500,
    reconnectSuccessPercent: 99,
    reconnectP95Ms: 5000,
  };
  const normal = {
    name: "normal-load",
    offered: 50,
    accepted: 50,
    missed: 0,
    latency: {
      rest: { count: 10, p95UpperMs: 300 },
      command: { count: 50, p95UpperMs: 300 },
      dispatchToAllRecipients: { count: 50, p95UpperMs: 500 },
    },
  };
  const counts = { reconnectAttempts: 100, reconnectSuccess: 99 };
  const reconnect = { count: 99, p95UpperMs: 5000 };
  const stress = {
    ...normal,
    name: "2x-load",
    latency: { ...normal.latency, command: { count: 100, p95UpperMs: 10000 } },
  };
  expect(normalCapacityGates([normal, stress], counts, targets, reconnect)).toBe(true);
  expect(normalCapacityGates([stress], counts, targets, reconnect)).toBe(false);
  expect(normalCapacityGates([{ ...normal, missed: 1 }], counts, targets, reconnect)).toBe(false);
  expect(normalCapacityGates([{ ...normal, accepted: 49 }], counts, targets, reconnect)).toBe(
    false,
  );
  expect(
    normalCapacityGates([normal], { ...counts, reconnectSuccess: 98 }, targets, reconnect),
  ).toBe(false);
});

it("rejects incomplete or reduced populations even when rate and latency could pass", () => {
  const profile = { normalCcu: 1000, normalMatches: 200, ccu: 2000, matches: 400 };
  const normal = { name: "normal-load", minConnectedClients: 1000, minActiveMatches: 200 };
  const stress = { name: "2x-load", minConnectedClients: 2000, minActiveMatches: 400 };
  const soak = { ...stress, name: "soak" };
  expect(capacityPopulationGates([normal, stress, soak], profile)).toBe(true);
  expect(capacityPopulationGates([normal], profile, ["normal-load"])).toBe(true);
  expect(capacityPopulationGates([normal, stress], profile)).toBe(false);
  expect(
    capacityPopulationGates([{ ...normal, minConnectedClients: 999 }], profile, ["normal-load"]),
  ).toBe(false);
  expect(
    capacityPopulationGates([{ ...normal, minActiveMatches: 199 }], profile, ["normal-load"]),
  ).toBe(false);
  expect(
    capacityPopulationGates([normal, stress, { ...soak, minActiveMatches: 399 }], profile),
  ).toBe(false);
  expect(
    capacityPopulationGates([normal, stress, soak, { ...soak, minActiveMatches: null }], profile),
  ).toBe(false);
});

it("counts slow observations instead of dropping histogram overflow", () => {
  const histogram = latencyHistogram();
  for (let i = 0; i < 19; i++) histogram.add(100);
  histogram.add(90000);
  expect(histogram.result()).toMatchObject({
    count: 20,
    p95UpperMs: 100,
    p99UpperMs: 90000,
    maximumMs: 90000,
  });
  expect(() => histogram.add(NaN)).toThrow();
});

it("rejects missing accepted receipts and duplicate result/statistics side effects", () => {
  const receipt = { actionId: "synthetic", stateVersion: 7 };
  const audit = {
    status: "FINISHED",
    seats: 2,
    results: 1,
    resultSeats: 2,
    finishEvents: 1,
    applications: 1,
    events: 8,
    lastEventSeq: 8,
    roomStatus: "CLOSED",
    receipts: [{ actionId: "synthetic", resultingVersion: 7 }],
  };
  expect(reconcileMatch(audit, [receipt])).toBe(true);
  for (const change of [
    { receipts: [] },
    { applications: 2 },
    { events: 7 },
    { results: 2 },
    { status: "ACTIVE" },
  ])
    expect(reconcileMatch({ ...audit, ...change }, [receipt])).toBe(false);
});

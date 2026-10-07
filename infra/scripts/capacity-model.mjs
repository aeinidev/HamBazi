// Harness limits describe this disposable release fixture, never launch capacity.
export const capacityFixturePresencePolicy = Object.freeze({
  // Explicit local experiment: production heartbeat/lease policy remains unselected.
  heartbeatIntervalMs: 10000,
  heartbeatTimeoutMs: 5000,
  leaseMs: 30000,
  graceMs: 60000,
  maxConnections: 4,
});

export function capacityProfile(input, smoke = false) {
  const keys = ["peakCcu", "peakMatches", "peakCommandsPerSecond"];
  if (
    !input ||
    Object.keys(input).some((key) => ![...keys, "soakSeconds", "targets"].includes(key))
  )
    throw new Error("CAPACITY_PROFILE_INVALID");
  for (const key of keys)
    if (!Number.isSafeInteger(input[key]) || input[key] < 1)
      throw new Error("CAPACITY_PROFILE_INVALID");
  if (input.peakMatches * 2 > input.peakCcu || input.peakCcu * 2 > 2000)
    throw new Error("CAPACITY_FIXTURE_LIMIT");
  const soakSeconds = input.soakSeconds ?? 7200;
  if (!Number.isSafeInteger(soakSeconds) || soakSeconds < (smoke ? 10 : 7200))
    throw new Error("CAPACITY_SOAK_TOO_SHORT");
  if (soakSeconds > 86400 || input.peakCommandsPerSecond > 100)
    throw new Error("CAPACITY_FIXTURE_LIMIT");
  const targetKeys = [
    "restP95Ms",
    "commandP95Ms",
    "dispatchToAllRecipientsP95Ms",
    "reconnectSuccessPercent",
    "reconnectP95Ms",
  ];
  if (
    !smoke &&
    (!input.targets ||
      Object.keys(input.targets).length !== targetKeys.length ||
      targetKeys.some((key) => !Number.isFinite(input.targets[key]) || input.targets[key] <= 0) ||
      input.targets.reconnectSuccessPercent > 100 ||
      input.targets.reconnectP95Ms > 60000)
  )
    throw new Error("CAPACITY_EXPLICIT_TARGETS_REQUIRED");
  return Object.freeze({
    ...input,
    soakSeconds,
    ccu: input.peakCcu * 2,
    matches: input.peakMatches * 2,
    commandsPerSecond: input.peakCommandsPerSecond * 2,
    normalCcu: input.peakCcu,
    normalMatches: input.peakMatches,
    normalCommandsPerSecond: input.peakCommandsPerSecond,
    normalLoadSeconds: smoke ? 10 : 300,
    warmupSeconds: smoke ? 0 : 60,
    loadSeconds: smoke ? 10 : 300,
    stormWaves: smoke ? 1 : 3,
    smoke,
  });
}

// Fixture headroom, never a production quota or an approved traffic model.
export function capacityFixtureLimits(ccu) {
  if (!Number.isSafeInteger(ccu) || ccu < 1 || ccu > 2000)
    throw new Error("CAPACITY_FIXTURE_LIMIT");
  return Object.freeze({
    httpRequestsPerMinute: Math.max(10000, ccu * 20),
    engineRequestsPerMinute: Math.max(10000, ccu * 20),
    socketConnectionsPerMinute: Math.max(10000, ccu * 20),
    socketEventsPerMinute: Math.max(10000, ccu * 180),
    maxHttpInFlight: Math.max(100, ccu),
    maxEngineInFlight: Math.max(100, ccu),
    maxConnections: Math.max(100, ccu * 2),
    maxPendingPerSocket: 100,
    maxPendingTotal: Math.max(1000, ccu * 4),
    maxSubscriptions: 10,
  });
}

export function capacityConnectionProfile(ccu) {
  capacityFixtureLimits(ccu);
  return Object.freeze({
    ccu,
    matches: 0,
    connectionOnly: true,
    smoke: false,
    warmupSeconds: 0,
    loadSeconds: 0,
    soakSeconds: 30,
    stormWaves: 1,
  });
}

export function capacityDriverBudgetSeconds(profile) {
  // Bounded fixture setup/drain allowance grows with the actual table count.
  // This is a test deadline, never a latency SLO or production operating budget.
  return (
    profile.warmupSeconds +
    (profile.normalLoadSeconds ?? 0) +
    profile.loadSeconds +
    profile.soakSeconds * (profile.connectionOnly ? 2 : 1) +
    600 +
    profile.matches * 10
  );
}

export function capacityHttpRetryAllowed(
  status,
  attempt,
  body,
  privateControl = false,
  retryable = false,
) {
  // The disposable driver repeats only unavailable reads or stable REST intents.
  return (
    status === 503 &&
    retryable === true &&
    Number.isSafeInteger(attempt) &&
    attempt >= 0 &&
    attempt < 3 &&
    !privateControl &&
    (body === undefined ||
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body?.commandId ?? ""))
  );
}

export function latencyGates(latency, counts, targets, reconnect) {
  if (!targets) return null;
  return (
    latency.rest.count > 0 &&
    latency.command.count > 0 &&
    latency.dispatchToAllRecipients.count > 0 &&
    latency.rest.p95UpperMs <= targets.restP95Ms &&
    latency.command.p95UpperMs <= targets.commandP95Ms &&
    latency.dispatchToAllRecipients.p95UpperMs <= targets.dispatchToAllRecipientsP95Ms &&
    reconnect?.count > 0 &&
    reconnect.p95UpperMs <= targets.reconnectP95Ms &&
    counts.reconnectAttempts > 0 &&
    (100 * counts.reconnectSuccess) / counts.reconnectAttempts >= targets.reconnectSuccessPercent
  );
}

// Normal-load SLOs are deliberately independent of stress/recovery observations.
export function normalCapacityGates(stages, counts, targets, reconnect) {
  const normal = stages.filter((stage) => stage.name === "normal-load");
  return (
    normal.length > 0 &&
    normal.every(
      (stage) =>
        stage.offered > 0 &&
        stage.accepted === stage.offered &&
        stage.missed === 0 &&
        latencyGates(stage.latency, counts, targets, reconnect),
    )
  );
}

export function capacityPopulationGates(
  stages,
  profile,
  requiredStages = ["normal-load", "2x-load", "soak"],
) {
  return requiredStages.every((name) => {
    const measured = stages.filter((stage) => stage.name === name);
    const ccu = name === "normal-load" ? profile.normalCcu : profile.ccu;
    const matches = name === "normal-load" ? profile.normalMatches : profile.matches;
    return (
      measured.length > 0 &&
      measured.every(
        (stage) =>
          Number.isSafeInteger(stage.minConnectedClients) &&
          stage.minConnectedClients >= ccu &&
          Number.isSafeInteger(stage.minActiveMatches) &&
          stage.minActiveMatches >= matches,
      )
    );
  });
}

export function capacityResources(api, db, info) {
  const apiFields = [
    "rssBytes",
    "heapUsedBytes",
    "eventLoopP99Ms",
    "eventLoopMaxMs",
    "cpuUserMicros",
    "cpuSystemMicros",
  ];
  const dbFields = ["numbackends", "xact_commit", "xact_rollback", "deadlocks"];
  if (
    !api ||
    Object.keys(api).length !== apiFields.length ||
    apiFields.some((key) => !Number.isFinite(api[key]) || api[key] < 0) ||
    !db ||
    Object.keys(db).length !== dbFields.length ||
    dbFields.some(
      (key) =>
        !["number", "string"].includes(typeof db[key]) ||
        !/^\d+$/.test(String(db[key])) ||
        !Number.isSafeInteger(Number(db[key])),
    )
  )
    throw new Error("CAPACITY_METRICS_INVALID");
  const scalar = (name) => {
    const value = new RegExp(`^${name}:(\\d+)\\r?$`, "m").exec(info)?.[1];
    if (value === undefined || !Number.isSafeInteger(Number(value)))
      throw new Error("CAPACITY_METRICS_INVALID");
    return Number(value);
  };
  return {
    api: Object.fromEntries(apiFields.map((key) => [key, api[key]])),
    db: Object.fromEntries(dbFields.map((key) => [key, Number(db[key])])),
    redis: {
      usedMemoryBytes: scalar("used_memory"),
      connectedClients: scalar("connected_clients"),
      commands: scalar("total_commands_processed"),
      rejectedConnections: scalar("rejected_connections"),
    },
  };
}

// Bounded histogram: percentiles are conservative upper bounds, including overflow.
export function latencyHistogram() {
  const bounds = [1, 2, 5, 10, 20, 50, 100, 200, 300, 500, 1000, 2000, 5000, 10000, 60000];
  const bins = Array(bounds.length).fill(0);
  let count = 0,
    maximumMs = 0;
  return {
    add(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new Error("CAPACITY_LATENCY_INVALID");
      count++;
      maximumMs = Math.max(maximumMs, ms);
      const index = bounds.findIndex((bound) => ms <= bound);
      bins[index < 0 ? bins.length - 1 : index]++;
    },
    result() {
      const percentile = (p) => {
        if (!count) return null;
        let total = 0;
        for (const [i, value] of bins.entries()) {
          total += value;
          if (total >= Math.ceil(count * p))
            return Math.max(bounds[i], i === bins.length - 1 ? maximumMs : 0);
        }
        return maximumMs;
      };
      return {
        count,
        p50UpperMs: percentile(0.5),
        p95UpperMs: percentile(0.95),
        p99UpperMs: percentile(0.99),
        maximumMs,
      };
    },
  };
}

export function reconcileMatch(audit, accepted) {
  return (
    audit.status === "FINISHED" &&
    audit.seats === 2 &&
    audit.results === 1 &&
    audit.resultSeats === 2 &&
    audit.finishEvents === 1 &&
    audit.applications === 1 &&
    audit.events === audit.lastEventSeq &&
    (audit.roomStatus === "CLOSED" ||
      (audit.matchType === "MATCHMAKING" && audit.roomStatus === null)) &&
    accepted.every((receipt) =>
      audit.receipts.some(
        (row) => row.actionId === receipt.actionId && row.resultingVersion === receipt.stateVersion,
      ),
    )
  );
}

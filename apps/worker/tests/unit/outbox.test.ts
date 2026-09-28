import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  matchDomainEventSchema,
  type MatchDomainEvent,
  type MatchOutboxPort,
} from "@hambazi/api/matches";
import { createOutboxDispatcher, domainEventProcessor } from "../../src/outbox-dispatcher.js";
function event(): MatchDomainEvent {
  const id = randomUUID();
  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    aggregateId: id,
    type: "MATCH_CHANGED_V1",
    occurredAt: 1000,
    correlation: {
      requestId: randomUUID(),
      traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
    },
    payload: { schemaVersion: 1, matchId: id, stateVersion: 3, lastEventSeq: 4, status: "ACTIVE" },
  };
}
function fixture() {
  const message = event();
  const port: MatchOutboxPort = {
    claim: vi.fn(async () => [{ eventId: message.eventId, attempt: 1, event: message }]),
    published: vi.fn(async () => true),
    failed: vi.fn(async () => true),
    redrive: vi.fn(async () => true),
  };
  const publisher = {
    publish: vi.fn(async (_event: MatchDomainEvent) => {}),
    close: vi.fn(async () => {}),
  };
  const report = vi.fn();
  const dispatcher = createOutboxDispatcher({
    outbox: port,
    publisher,
    event: report,
    batchSize: 3,
    publishTimeoutMs: 20,
  });
  return { port, publisher, report, dispatcher, message };
}
describe("outbox dispatch boundaries", () => {
  it("marks only after accepted publication and forwards correlation, not raw payload telemetry", async () => {
    const f = fixture();
    f.publisher.publish.mockImplementation(async () => {
      expect(f.port.published).not.toHaveBeenCalled();
    });
    await f.dispatcher.runOnce();
    expect(f.publisher.publish).toHaveBeenCalledWith(f.message);
    expect(f.port.published).toHaveBeenCalledWith(f.message.eventId, 1);
    expect(f.report).toHaveBeenCalledWith("worker.outbox_published", {
      matchId: f.message.aggregateId,
      stateVersion: 3,
      requestId: f.message.correlation.requestId,
    });
    expect(JSON.stringify(f.report.mock.calls)).not.toMatch(/payload|traceparent|token/);
  });
  it("does not mark failed sends and sanitizes errors", async () => {
    const f = fixture();
    f.publisher.publish.mockRejectedValue(new Error("SYNTHETIC_PRIVATE"));
    await f.dispatcher.runOnce();
    expect(f.port.published).not.toHaveBeenCalled();
    expect(f.port.failed).toHaveBeenCalledWith(f.message.eventId, 1);
    expect(JSON.stringify(f.report.mock.calls)).not.toContain("SYNTHETIC_PRIVATE");
  });
  it("bounds a stuck publication; late acceptance cannot mark its expired claim", async () => {
    const f = fixture();
    let resolve!: () => void;
    f.publisher.publish.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    await f.dispatcher.runOnce();
    resolve();
    expect(f.port.failed).toHaveBeenCalled();
    expect(f.port.published).not.toHaveBeenCalled();
  });
  it("quarantines unknown schemas instead of publishing arbitrary storage", async () => {
    const f = fixture();
    vi.mocked(f.port.claim).mockResolvedValue([
      { eventId: f.message.eventId, attempt: 1, event: null },
    ]);
    await f.dispatcher.runOnce();
    expect(f.publisher.publish).not.toHaveBeenCalled();
    expect(f.port.failed).toHaveBeenCalledWith(f.message.eventId, 1, true);
  });
  it("recovers mark uncertainty through lease expiry rather than claiming publish failed", async () => {
    const f = fixture();
    vi.mocked(f.port.published).mockRejectedValue(new Error("SYNTHETIC_DB"));
    await f.dispatcher.runOnce();
    expect(f.port.failed).not.toHaveBeenCalled();
    expect(f.report).toHaveBeenCalledWith("worker.outbox_unavailable", undefined);
  });
  it("joins overlapping ticks, drains and refuses claims after close", async () => {
    const f = fixture();
    let release!: () => void;
    f.publisher.publish.mockImplementation(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const first = f.dispatcher.runOnce();
    const second = f.dispatcher.runOnce();
    expect(first).toBe(second);
    await Promise.resolve();
    const closing = f.dispatcher.close();
    release();
    await closing;
    await f.dispatcher.runOnce();
    expect(f.port.claim).toHaveBeenCalledTimes(1);
  });
});
describe("versioned consumer adapter", () => {
  it("retains correlation and recognizes a durable duplicate", async () => {
    const e = event();
    const consume = vi.fn(async () => "DUPLICATE" as const);
    expect(await domainEventProcessor(e.type, consume)({ name: e.type, data: e })).toEqual({
      schemaVersion: 1,
      status: "DUPLICATE",
    });
    expect(consume).toHaveBeenCalledWith(e);
  });
  it("rejects type/version/aggregate mismatch and sanitizes consumer failures", async () => {
    const e = event();
    const consume = vi.fn(async () => {
      throw new Error("SYNTHETIC_PRIVATE");
    });
    const run = domainEventProcessor(e.type, consume);
    await expect(run({ name: e.type, data: { ...e, schemaVersion: 2 } })).rejects.toThrow(
      "Invalid domain job",
    );
    expect(consume).not.toHaveBeenCalled();
    expect(matchDomainEventSchema.safeParse({ ...e, aggregateId: randomUUID() }).success).toBe(
      false,
    );
    await expect(run({ name: e.type, data: e })).rejects.toThrow(/^Domain consumer failed$/);
  });
});

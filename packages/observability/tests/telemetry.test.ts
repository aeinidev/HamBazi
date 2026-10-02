import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createCorrelation,
  currentCorrelation,
  withCorrelation,
  createTelemetryLogger,
  telemetryFields,
  safeTraceparent,
  reportTelemetry,
} from "../src/index.js";

const parent = {
  requestId: randomUUID(),
  traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
};
function logs() {
  const output: string[] = [];
  return {
    output,
    logger: createTelemetryLogger({
      write: (line: string) => {
        output.push(line);
      },
    }),
  };
}
describe("deny-by-default telemetry", () => {
  it("projects only fixed events, stable codes, canonical IDs and finite counters", () => {
    const f = logs();
    const id = randomUUID();
    f.logger.emit("socket.completed", {
      requestId: id.toUpperCase(),
      userId: id,
      roomId: id,
      matchId: id,
      actionId: id,
      stateVersion: 7,
      durationMs: 3.4,
      errorCode: "GAME_STATE_CONFLICT",
      traceparent: parent.traceparent,
      event: "PRIVATE_EVENT",
      message: "PRIVATE_MESSAGE",
      err: new Error("PRIVATE_ERROR"),
      initData: "PRIVATE_AUTH",
      accessToken: "PRIVATE_TOKEN",
      botToken: "PRIVATE_BOT",
      chat: { text: "PRIVATE_CHAT" },
      state: { deck: ["PRIVATE_CARD"], seed: "PRIVATE_RNG" },
      traceId: "PRIVATE_TRACE",
      spanId: "PRIVATE_SPAN",
      headers: { authorization: "PRIVATE_BEARER" },
    });
    expect(JSON.parse(f.output[0]!)).toEqual({
      level: 30,
      event: "socket.completed",
      requestId: id,
      userId: id,
      roomId: id,
      matchId: id,
      actionId: id,
      stateVersion: 7,
      durationMs: 3,
      errorCode: "GAME_STATE_CONFLICT",
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
    });
    expect(f.output.join("")).not.toContain("PRIVATE");
  });
  it.each([NaN, Infinity, -1, "1", {}, Number.MAX_SAFE_INTEGER + 1])(
    "drops malformed numeric values %#",
    (bad) => {
      expect(telemetryFields({ stateVersion: bad, durationMs: bad })).toEqual({});
    },
  );
  it("rejects arbitrary event/code text and raw scalar inputs", () => {
    const f = logs();
    f.logger.emit("PRIVATE_EVENT" as never, { requestId: randomUUID() });
    expect(f.output).toHaveLength(0);
    expect(
      telemetryFields({
        errorCode: "PRIVATE_ERROR",
        requestId: "PRIVATE_AUTH",
        userId: { toString: () => "PRIVATE_AUTH" },
      }),
    ).toEqual({});
    expect(telemetryFields(new Error("PRIVATE_ERROR"))).toEqual({});
  });
  it("never invokes getters, inherited properties or toJSON", () => {
    const getter = vi.fn(() => {
      throw new Error("PRIVATE");
    });
    const hostile = Object.create({ userId: randomUUID() });
    Object.defineProperty(hostile, "requestId", { get: getter });
    hostile.toJSON = getter;
    expect(telemetryFields(hostile)).toEqual({});
    expect(getter).not.toHaveBeenCalled();
    const proxy = new Proxy({}, { getOwnPropertyDescriptor: getter });
    expect(telemetryFields(proxy)).toEqual({});
  });
  it("cannot turn observer/write errors into application failures", () => {
    const broken = createTelemetryLogger({
      write: () => {
        throw new Error("PRIVATE_DESTINATION");
      },
    });
    expect(() => broken.emit("worker.started")).not.toThrow();
    expect(() =>
      reportTelemetry(
        {
          emit: () => {
            throw new Error("PRIVATE");
          },
        },
        "worker.started",
      ),
    ).not.toThrow();
  });
});
describe("causal context", () => {
  it("creates server roots and child spans without accepting arbitrary metadata", () => {
    const root = createCorrelation({
      requestId: "PRIVATE",
      traceparent: "PRIVATE",
      token: "PRIVATE",
    });
    expect(root.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(safeTraceparent(root.traceparent)).toBe(root.traceparent);
    const child = createCorrelation(parent);
    expect(child.requestId).toBe(parent.requestId);
    expect(child.traceparent.slice(3, 35)).toBe(parent.traceparent.slice(3, 35));
    expect(child.traceparent.slice(36, 52)).not.toBe(parent.traceparent.slice(36, 52));
    expect(child.traceparent.slice(53)).toBe("01");
    expect(Object.isFrozen(child)).toBe(true);
  });
  it.each([
    "00-" + "0".repeat(32) + "-" + "1".repeat(16) + "-01",
    "00-" + "1".repeat(32) + "-" + "0".repeat(16) + "-01",
    parent.traceparent.replaceAll("1", "a").toUpperCase(),
    parent.traceparent + "," + parent.traceparent,
    parent.traceparent.replace("00-", "01-"),
    parent.traceparent.slice(0, 53) + "02",
  ])("rejects unsupported or malformed trace context %#", (bad) => {
    expect(safeTraceparent(bad)).toBeUndefined();
    expect(telemetryFields({ traceparent: bad })).toEqual({});
  });
  it("isolates concurrent async operations and restores nested/failed work", async () => {
    const f = logs();
    const contexts = Array.from({ length: 20 }, () => createCorrelation());
    await Promise.all(
      contexts.map((context) =>
        withCorrelation(context, async () => {
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(currentCorrelation()).toEqual(context);
          const nested = createCorrelation(context);
          expect(() =>
            withCorrelation(nested, () => {
              throw new Error("PRIVATE");
            }),
          ).toThrow("PRIVATE");
          expect(currentCorrelation()).toEqual(context);
          f.logger.emit("worker.domain_completed");
        }),
      ),
    );
    expect(currentCorrelation()).toBeUndefined();
    expect(new Set(f.output.map((line) => JSON.parse(line).requestId))).toEqual(
      new Set(contexts.map((c) => c.requestId)),
    );
    await expect(
      withCorrelation(createCorrelation(), async () => {
        throw new Error("PRIVATE");
      }),
    ).rejects.toThrow();
    expect(currentCorrelation()).toBeUndefined();
  });
});

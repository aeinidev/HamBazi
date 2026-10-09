import { describe, it, expect } from "vitest";
import { createTelemetryLogger } from "@hambazi/observability";
import { createBotTiming, messageAge } from "../../src/timing.js";
import { createDeliveryHandler } from "../../src/delivery.js";
import { fixture, raw } from "./fixtures.js";
describe("privacy-safe bot timings", () => {
  it("records admitted ingress, backend, outbound send and acknowledgement in order without content/Telegram identity", async () => {
    const lines: string[] = [];
    const f = fixture();
    const input = raw("پروفایل من");
    Object.assign(input.message, { date: 100 });
    const timing = createBotTiming(
      createTelemetryLogger({
        write: (v) => {
          lines.push(String(v));
        },
      }),
    );
    await createDeliveryHandler({ ...f, timing })(input, AbortSignal.timeout(1000), 100700);
    const events = lines.map((v) => JSON.parse(v));
    expect(events.map((e) => e.operation)).toEqual([
      "bot_ingress",
      "bot_process",
      "bot_reply_send",
      "bot_reply_ack",
      "bot_profile",
    ]);
    expect(events[0].durationMs).toBe(700);
    expect(events.every((e) => typeof e.durationMs === "number" && e.durationMs >= 0)).toBe(true);
    expect(lines.join("")).not.toContain("پروفایل");
    expect(
      events.every((e) =>
        Object.keys(e).every((k) => ["level", "event", "operation", "durationMs"].includes(k)),
      ),
    ).toBe(true);
  });
  it("a failed observer cannot change delivery; failures record only a stable error code", async () => {
    const f = fixture();
    await createDeliveryHandler({
      ...f,
      timing: createBotTiming({
        emit() {
          throw Error("private payload");
        },
      }),
    })(raw(), AbortSignal.timeout(1000));
    expect(f.sender.send).toHaveBeenCalledOnce();
  });
  it("ignores absent, future or accessor timestamps", () => {
    expect(messageAge({}, 100)).toBeUndefined();
    expect(messageAge({ message: { date: 2 } }, 1000)).toBeUndefined();
    expect(
      messageAge(
        {
          get message() {
            throw Error("must not execute");
          },
        },
        1000,
      ),
    ).toBeUndefined();
    expect(
      messageAge(
        {
          message: {
            get date() {
              throw Error("must not execute");
            },
          },
        },
        1000,
      ),
    ).toBeUndefined();
  });
});

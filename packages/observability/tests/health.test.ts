import { request } from "node:http";
import { expect, it, vi } from "vitest";
import { createServiceHealth, startHealthServer, withDeadline, healthPaths } from "../src/index.js";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
it("separates process liveness, durable readiness and optional degradation with recovery", async () => {
  let postgres = true;
  let redis = true;
  const health = createServiceHealth(
    [
      { required: true, probe: async () => postgres },
      { required: false, probe: async () => redis },
    ],
    100,
  );
  expect((await health.ready()).status).toBe("NOT_READY");
  expect(health.live().status).toBe("LIVE");
  health.started();
  expect((await health.ready()).status).toBe("READY");
  redis = false;
  expect((await health.ready()).status).toBe("DEGRADED");
  postgres = false;
  expect((await health.ready()).status).toBe("NOT_READY");
  expect(health.live().status).toBe("LIVE");
  postgres = redis = true;
  expect((await health.ready()).status).toBe("READY");
  health.stopAdmission();
  health.started();
  expect(health.accepting()).toBe(false);
  expect((await health.ready()).status).toBe("NOT_READY");
  health.stopped();
  expect(health.live().status).toBe("LIVE");
});
it("fences a successful in-flight probe when drain starts", async () => {
  const latch = deferred<boolean>();
  const health = createServiceHealth([{ required: true, probe: () => latch.promise }], 100);
  health.started();
  const probe = health.ready();
  health.stopAdmission();
  latch.resolve(true);
  expect((await probe).status).toBe("NOT_READY");
});
it("bounds a hung probe, cancels cooperatively and coalesces concurrent/late requests", async () => {
  const latch = deferred<boolean>();
  let signal!: AbortSignal;
  const probe = vi.fn(async (s: AbortSignal) => {
    signal = s;
    return latch.promise;
  });
  const health = createServiceHealth([{ required: true, probe }], 10);
  health.started();
  const results = await Promise.all(Array.from({ length: 10 }, () => health.ready()));
  expect(results.every((r) => r.status === "NOT_READY")).toBe(true);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(signal.aborted).toBe(true);
  await health.ready();
  expect(probe).toHaveBeenCalledTimes(1);
  latch.resolve(true);
  await latch.promise;
  await new Promise((r) => setImmediate(r));
  expect((await health.ready()).status).toBe("READY");
  expect(probe).toHaveBeenCalledTimes(2);
});
it("reports a drain deadline without cancelling the accepted effect", async () => {
  const latch = deferred<void>();
  let finished = false;
  const work = latch.promise.then(() => {
    finished = true;
  });
  await expect(withDeadline(work, 10)).rejects.toThrow("Operation deadline exceeded");
  expect(finished).toBe(false);
  latch.resolve();
  await work;
  expect(finished).toBe(true);
});
it("serves exact loopback GET probes with no dependency details, proxy/browser access or content", async () => {
  const health = createServiceHealth(
    [
      {
        required: true,
        probe: async () => {
          throw new Error("PRIVATE_DATABASE_URL");
        },
      },
    ],
    100,
  );
  health.started();
  const server = await startHealthServer(health, 0);
  async function get(path: string, headers: Record<string, string> = {}, method = "GET") {
    return new Promise<{ code: number; body: string }>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: server.port, path, method, headers, agent: false },
        (res) => {
          let body = "";
          res.on("data", (v) => (body += v));
          res.on("end", () => resolve({ code: res.statusCode!, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }
  try {
    expect(await get(healthPaths.live)).toEqual({
      code: 200,
      body: '{"schemaVersion":1,"status":"LIVE"}',
    });
    expect(await get(healthPaths.ready)).toEqual({
      code: 503,
      body: '{"schemaVersion":1,"status":"NOT_READY"}',
    });
    for (const headers of [
      { origin: "https://mini.example" },
      { forwarded: "for=127.0.0.1" },
      { host: "evil.example" },
    ])
      expect((await get(healthPaths.ready, headers)).code).toBe(404);
    expect((await get(healthPaths.ready + "?secret=PRIVATE", {})).code).toBe(404);
    expect((await get(healthPaths.live, {}, "POST")).code).toBe(404);
  } finally {
    await server.close();
    await server.close();
  }
});

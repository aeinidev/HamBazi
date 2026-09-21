import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { request as plainRequest } from "node:http";
import {
  botInternalPaths as paths,
  botInternalOpenApiDocument,
  type RateDecision,
} from "../../src/auth/index.js";
import { createSafeLogger } from "../../src/composition/safe-logger.js";
import { startBotInternalTransport } from "../../src/composition/bot-internal-runtime.js";
import { compatibleAuthContract } from "../../scripts/contract-compatibility.mjs";
import { botFixture, update } from "../auth/bot-onboarding-fixtures.js";
import { internalHarness, testCertificate, bearer } from "./bot-internal-fixture.js";
let tls: Awaited<ReturnType<typeof testCertificate>>;
beforeAll(async () => {
  tls = await testCertificate();
});
const active: Awaited<ReturnType<typeof internalHarness>>[] = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((h) => h.app.close()));
});
async function setup(allowedPeers?: string) {
  const f = botFixture();
  const output: string[] = [];
  const ip = vi.fn(async (): Promise<RateDecision> => ({ allowed: true }));
  const identity = vi.fn(async (): Promise<RateDecision> => ({ allowed: true }));
  const service = { ...f.service };
  const process = vi.spyOn(service, "process");
  const h = await internalHarness({
    tls,
    onboarding: service,
    limiter: { consumeIp: ip, consumeIdentity: identity },
    logger: createSafeLogger({
      write: (v: string) => {
        output.push(v);
      },
    }),
    ...(allowedPeers ? { allowedPeers } : {}),
  });
  active.push(h);
  return { ...f, ...h, ip, identity, process, output };
}
describe("internal HTTPS boundary", () => {
  it("processes, acknowledges and suppresses completed duplicate delivery", async () => {
    const f = await setup();
    expect((await f.post(paths.admit, { schemaVersion: 1 })).status).toBe(200);
    const result = await f.post(paths.process, update("CREATE"));
    expect(result.status).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toMatchObject({ ok: true, status: "REPLY", delivery: { reply: "PROMPT_NAME" } });
    const duplicate = await f.post(paths.process, update("CREATE"));
    expect(duplicate.status).toBe(503);
    expect(duplicate.headers["retry-after"]).toBe("1");
    expect(
      (
        await f.post(paths.acknowledge, {
          schemaVersion: 1,
          receiptId: body.delivery.receiptId,
          version: body.delivery.version,
          messageId: 900,
        })
      ).status,
    ).toBe(200);
    expect(JSON.parse((await f.post(paths.process, update("CREATE"))).body).status).toBe("DONE");
    expect(f.ip).toHaveBeenCalledWith("bot:123");
    expect(f.identity).toHaveBeenCalledWith("123:100");
    expect(result.headers["cache-control"]).toBe("no-store");
  });
  it("requires a trusted TLS certificate and rejects plaintext", async () => {
    const f = await setup();
    await expect(f.post(paths.admit, { schemaVersion: 1 }, {}, false)).rejects.toThrow();
    const status = await new Promise<number>((resolve) => {
      const r = plainRequest(
        { host: "127.0.0.1", port: f.port, path: paths.admit, method: "POST", agent: false },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      r.on("error", () => resolve(0));
      r.setTimeout(2000, () => r.destroy());
      r.end();
    });
    expect(status).not.toBe(200);
    expect(f.ip).not.toHaveBeenCalled();
  });
  it.each(["origin", "forwarded", "x-forwarded-for", "x-forwarded-proto"])(
    "rejects %s instead of trusting it",
    async (header) => {
      const f = await setup();
      expect(
        (await f.post(paths.admit, { schemaVersion: 1 }, { [header]: "127.0.0.1" })).status,
      ).toBe(403);
      expect(f.ip).not.toHaveBeenCalled();
    },
  );
  it("rejects a valid credential from an unconfigured direct peer", async () => {
    const f = await setup("10.1.2.3");
    expect((await f.post(paths.admit, { schemaVersion: 1 })).status).toBe(401);
  });
  it.each(["", "Bearer player.jwt.value", "Bearer wrong.secret"])(
    "rejects forged service authentication %# before parsing",
    async (authorization) => {
      const f = await setup();
      expect((await f.post(paths.process, "{", { authorization })).status).toBe(401);
      expect(f.ip).not.toHaveBeenCalled();
    },
  );
  it("rejects duplicate raw Authorization headers", async () => {
    const f = await setup();
    expect(
      (await f.post(paths.admit, { schemaVersion: 1 }, { authorization: [bearer, bearer] })).status,
    ).toBe(401);
  });
  it.each([
    ["{", 400],
    ["x".repeat(5000), 413],
    [{ ...update("START"), userId: "forged" }, 400],
    [{ ...update("START"), chatId: "101" }, 400],
  ])("rejects malformed/oversized/forged bodies %#", async (body, status) => {
    const f = await setup();
    expect((await f.post(paths.process, body)).status).toBe(status);
    expect(f.process).not.toHaveBeenCalled();
  });
  it("applies the global budget before malformed-body parsing and on acknowledgements", async () => {
    const f = await setup();
    f.ip.mockResolvedValue({ allowed: false, reason: "limited", retryAfterSeconds: 7 });
    for (const path of Object.values(paths)) {
      const r = await f.post(path, "{");
      expect(r.status).toBe(429);
      expect(r.headers["retry-after"]).toBe("7");
    }
    expect(f.process).not.toHaveBeenCalled();
  });
  it("fails admission closed when Redis is unavailable", async () => {
    const f = await setup();
    f.ip.mockResolvedValue({ allowed: false, reason: "unavailable" });
    expect((await f.post(paths.admit, { schemaVersion: 1 })).status).toBe(503);
    expect(f.process).not.toHaveBeenCalled();
  });
  it("limits verified identities before backend effects", async () => {
    const f = await setup();
    f.identity.mockResolvedValue({ allowed: false, reason: "limited", retryAfterSeconds: 2 });
    expect((await f.post(paths.process, update("START"))).status).toBe(429);
    expect(f.process).not.toHaveBeenCalled();
  });
  it("sanitizes thrown dependency failures and logs no payload or bearer", async () => {
    const f = await setup();
    f.process.mockRejectedValue(new Error("private database failure"));
    const r = await f.post(paths.process, {
      ...update("NAME"),
      displayName: "private submitted name",
    });
    expect(r.status).toBe(500);
    expect(r.body).not.toContain("private");
    for (const text of ["private", bearer, "displayName", "authorization"])
      expect(f.output.join("")).not.toContain(text);
  });
  it("rejects unexpected response fields rather than leaking them", async () => {
    const f = await setup();
    f.process.mockResolvedValue({
      ok: true,
      schemaVersion: 1,
      status: "DONE",
      secret: "private",
    } as unknown as Awaited<ReturnType<typeof f.service.process>>);
    expect((await f.post(paths.process, update("START"))).status).toBe(500);
  });
  it("rejects query strings and does not expose player routes", async () => {
    const f = await setup();
    expect((await f.post(paths.admit + "?userId=100", { schemaVersion: 1 })).status).toBe(400);
    expect((await f.post("/v1/auth/telegram-mini-app", { schemaVersion: 1 })).status).toBe(404);
  });
  it("keeps disabled startup free of privileged dependencies", async () => {
    const onboarding = vi.fn();
    const reveal = vi.fn();
    expect(
      await startBotInternalTransport({
        environment: {},
        redisUrl: { reveal },
        onboarding,
        logger: createSafeLogger({ write: () => {} }),
      }),
    ).toBeUndefined();
    expect(onboarding).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });
});
describe("separate internal v1 contract", () => {
  const baseline = () =>
    JSON.parse(
      readFileSync(
        new URL("../../../../docs/contracts/bot-internal.v1.baseline.json", import.meta.url),
        "utf8",
      ),
    );
  it("matches the versioned baseline", () =>
    expect(compatibleAuthContract(baseline(), botInternalOpenApiDocument())).toBe(true));
  it.each(["path", "security", "schema"])("rejects breaking %s changes", (kind) => {
    const next = baseline();
    if (kind === "path") delete next.paths[paths.process];
    if (kind === "security") next.paths[paths.process].post.security = [];
    if (kind === "schema")
      next.paths[paths.admit].post.requestBody.content["application/json"].schema.required.push(
        "senderId",
      );
    expect(compatibleAuthContract(baseline(), next)).toBe(false);
  });
});

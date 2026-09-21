import { describe, expect, it } from "vitest";
import { inspect } from "node:util";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { parseBotServiceConfig } from "@hambazi/config";
import { createBotServiceAuthenticator } from "../../src/auth/index.js";
import { fixture, initData, commandId } from "./session-fixtures.js";

const secret = Buffer.alloc(32, 17).toString("base64url");
const previous = Buffer.alloc(64, 18).toString("base64url");
const environment = {
  TELEGRAM_BOT_TOKEN: `123:${"a".repeat(32)}`,
  AUTH_SESSION_SECONDS: "900",
  AUTH_TELEGRAM_MAX_AGE_SECONDS: "300",
  AUTH_TELEGRAM_FUTURE_SKEW_SECONDS: "30",
  AUTH_IP_LIMIT: "30",
  AUTH_IDENTITY_LIMIT: "6",
  AUTH_ACTIVE_KEY_ID: "session",
  AUTH_ISSUER: "test",
  AUTH_AUDIENCE: "mini-app",
  AUTH_SIGNING_KEYS: JSON.stringify([
    { id: "session", secret: Buffer.alloc(32, 19).toString("base64url") },
  ]),
  API_TRUSTED_PROXIES: "",
  API_BIND_ADDRESS: "127.0.0.1",
  API_DB_POOL_MAX: "5",
  BOT_SERVICE_ACTIVE_KEY_ID: "current",
  BOT_SERVICE_KEYS: JSON.stringify([
    { id: "current", secret },
    { id: "previous", secret: previous },
  ]),
  BOT_SERVICE_ALLOWED_PEERS: "127.0.0.1,10.2.3.4,::1,fd00::1",
  TELEGRAM_WEBHOOK_SECRET: "w".repeat(40),
};
export function serviceFixture() {
  return createBotServiceAuthenticator(parseBotServiceConfig(environment));
}
const request = {
  rawHeaders: ["Authorization", `Bearer current.${secret}`],
  remoteAddress: "127.0.0.1",
  requiredScope: "bot:onboarding",
};

describe("scoped Bot service authentication", () => {
  it.each([
    "127.0.0.1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "10.2.3.4",
    "::1",
    "fd00:0:0:0:0:0:0:1",
  ])("accepts only the configured direct peer %s", (remoteAddress) => {
    expect(serviceFixture().authenticate({ ...request, remoteAddress })).toEqual({
      schemaVersion: 1,
      botId: "123",
      scope: "bot:onboarding",
    });
  });
  it.each([
    undefined,
    "",
    "8.8.8.8",
    "127.0.0.2",
    "10.2.3.5",
    "::2",
    "fd00::2",
    "::ffff:8.8.8.8",
    "localhost",
    "127.0.0.1:123",
    "::1%lo",
  ])("denies unconfigured/invalid peers %s despite forwarded headers", (remoteAddress) => {
    expect(
      serviceFixture().authenticate({
        ...request,
        remoteAddress,
        rawHeaders: [
          ...request.rawHeaders,
          "X-Forwarded-For",
          "127.0.0.1",
          "Forwarded",
          "for=127.0.0.1;proto=https",
        ],
      }),
    ).toBeUndefined();
  });
  it.each(["player", "admin", "", "bot:onboarding:extra"])("denies scope %s", (requiredScope) => {
    expect(serviceFixture().authenticate({ ...request, requiredScope })).toBeUndefined();
  });
  it.each([
    "",
    secret,
    `Basic current.${secret}`,
    `Bearer current.${secret}=`,
    `Bearer current.${secret} `,
    ` Bearer current.${secret}`,
    `Bearer  current.${secret}`,
    `Bearer unknown.${secret}`,
    `Bearer Current.${secret}`,
    `Bearer current.${previous}`,
    `Bearer current.${Buffer.alloc(32, 8).toString("base64url")}`,
    `Bearer current.${secret.slice(0, -1)}F`,
    `Bearer current.${secret}.extra`,
    "x".repeat(10000),
  ])("denies malformed or forged credentials (case %#)", (authorization) => {
    expect(
      serviceFixture().authenticate({ ...request, rawHeaders: ["Authorization", authorization] }),
    ).toBeUndefined();
  });
  it("rejects missing, duplicate and malformed raw header pairs", () => {
    for (const rawHeaders of [
      [],
      ["Authorization"],
      [...request.rawHeaders, "aUtHoRiZaTiOn", request.rawHeaders[1]!],
      ["Authorization", "", ...request.rawHeaders],
      Array(258).fill("x"),
    ])
      expect(serviceFixture().authenticate({ ...request, rawHeaders })).toBeUndefined();
    expect(
      serviceFixture().authenticate({
        ...request,
        rawHeaders: ["authorization", `bearer current.${secret}`],
      }),
    ).toBeDefined();
  });
  it("accepts overlap then removes the previous credential on reconstruction", () => {
    const old = { ...request, rawHeaders: ["Authorization", `Bearer previous.${previous}`] };
    expect(serviceFixture().authenticate(old)).toBeDefined();
    const rotated = createBotServiceAuthenticator(
      parseBotServiceConfig({
        ...environment,
        BOT_SERVICE_KEYS: JSON.stringify([{ id: "current", secret }]),
      }),
    );
    expect(rotated.authenticate(old)).toBeUndefined();
    expect(rotated.authenticate(request)).toBeDefined();
  });
  it("does not disclose credentials in context or authenticator inspection", () => {
    const service = serviceFixture();
    const context = service.authenticate(request);
    expect(Object.isFrozen(context)).toBe(true);
    for (const value of [inspect(service, { depth: 8 }), JSON.stringify(context)]) {
      expect(value).not.toContain(secret);
      expect(value).not.toContain(previous);
    }
    expect(context).not.toHaveProperty("userId");
    expect(context).not.toHaveProperty("sessionId");
  });
  it("keeps player and service credentials disjoint", async () => {
    const { service } = fixture();
    const issued = await service.issue(initData(), commandId);
    if (!issued.ok) throw new Error("test session issuance failed");
    expect(
      serviceFixture().authenticate({
        ...request,
        rawHeaders: ["Authorization", `Bearer ${issued.accessToken.reveal()}`],
      }),
    ).toBeUndefined();
    expect((await service.authenticate(`current.${secret}`)).ok).toBe(false);
  });
  it("uses actual socket peers and original duplicate headers in a loopback transport harness", async () => {
    const authenticator = serviceFixture();
    // Test-only plain HTTP listener: this does not implement or validate production TLS ingress.
    const server = createServer((incoming, response) => {
      const context = authenticator.authenticate({
        rawHeaders: incoming.rawHeaders,
        remoteAddress: incoming.socket.remoteAddress,
        requiredScope: "bot:onboarding",
      });
      response.statusCode = context ? 204 : 401;
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as AddressInfo).port;
    async function send(headers: string[]) {
      return new Promise<number | undefined>((resolve, reject) => {
        const outgoing = httpRequest(
          { host: "127.0.0.1", port, headers, agent: false },
          (response) => {
            response.resume();
            response.once("end", () => resolve(response.statusCode));
          },
        );
        outgoing.once("error", reject);
        outgoing.setTimeout(2000, () => outgoing.destroy(new Error("test request timed out")));
        outgoing.end();
      });
    }
    try {
      const headers = ["Host", "localhost", ...request.rawHeaders];
      expect(await send(headers)).toBe(204);
      expect(await send([...headers, "authorization", request.rawHeaders[1]!])).toBe(401);
      expect(await send(["Host", "localhost", "X-Forwarded-For", "127.0.0.1"])).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

import { expect, it } from "vitest";
import {
  canonicalIp,
  createPeerResolver,
  createRedisTransportAdmission,
} from "../../src/realtime/index.js";
import { admissionPolicy } from "../fixtures/admission.js";
function request(remoteAddress: string, forwarded?: string) {
  return {
    socket: { remoteAddress },
    headers: { "x-forwarded-for": forwarded },
  } as unknown as Parameters<ReturnType<typeof createPeerResolver>>[0];
}
it.each([
  ["127.0.0.1", "127.0.0.1"],
  ["::ffff:127.0.0.1", "127.0.0.1"],
  ["0:0:0:0:0:ffff:7f00:1", "127.0.0.1"],
  ["2001:DB8:0:0::1", "2001:db8::1"],
  ["not-an-ip", undefined],
  ["fe80::1%eth0", undefined],
])("canonicalizes %s without multiplying budgets", (input, expected) =>
  expect(canonicalIp(input!)).toBe(expected),
);
it("ignores untrusted forwarding and stops at the first untrusted hop", () => {
  expect(createPeerResolver([])(request("::ffff:127.0.0.1", "203.0.113.1"))).toBe("127.0.0.1");
  const resolve = createPeerResolver(["192.0.2.0/24", "2001:db8::/32"]);
  const mapped = createPeerResolver(["::ffff:192.0.2.0/120"]);
  expect(mapped(request("::ffff:192.0.2.1", "198.51.100.2"))).toBe("198.51.100.2");
  expect(mapped(request("192.0.3.1", "198.51.100.2"))).toBe("192.0.3.1");
  expect(() => createPeerResolver(["::ffff:192.0.2.0/96"])).toThrow(
    "Invalid transport proxy configuration",
  );
  expect(resolve(request("192.0.2.1", "198.51.100.2, 192.0.2.3"))).toBe("198.51.100.2");
  expect(resolve(request("192.0.2.1", "203.0.113.9, 198.51.100.2"))).toBe("198.51.100.2");
  expect(resolve(request("2001:db8::1", "198.51.100.2"))).toBe("198.51.100.2");
  expect(resolve(request("192.0.2.1", "malformed, 203.0.113.9"))).toBe("192.0.2.1");
  expect(resolve(request("192.0.2.1", Array(33).fill("203.0.113.1").join(",")))).toBe("192.0.2.1");
  expect(
    resolve.secure({ ...request("198.51.100.2"), headers: { "x-forwarded-proto": "https" } }),
  ).toBe(false);
  expect(
    resolve.secure({ ...request("192.0.2.1"), headers: { "x-forwarded-proto": "https" } }),
  ).toBe(true);
  expect(
    resolve.secure({ ...request("192.0.2.1"), headers: { "x-forwarded-proto": "https, http" } }),
  ).toBe(false);
});
it.each(["0.0.0.0/0", "::/0", "true", "192.0.2.1/33", "::1/129", "192.0.2.1/2/3"])(
  "rejects unsafe proxy policy %s",
  (value) => {
    expect(() => createPeerResolver([value])).toThrow("Invalid transport proxy configuration");
  },
);
it("fails closed without Redis and validates configuration before opening a connection", async () => {
  const adapter = createRedisTransportAdmission({
    url: { reveal: () => "redis://127.0.0.1:1" },
    namespace: "test",
    policy: admissionPolicy,
  });
  try {
    expect(await adapter.ip("127.0.0.1", "http")).toEqual({
      allowed: false,
      reason: "unavailable",
    });
    expect(await adapter.rate("forged", "event")).toEqual({
      allowed: false,
      reason: "unavailable",
    });
    expect(await adapter.probe(AbortSignal.timeout(50))).toBe(false);
  } finally {
    adapter.close();
  }
  expect(() =>
    createRedisTransportAdmission({
      url: {
        reveal: () => {
          throw new Error("must not read secret");
        },
      },
      namespace: "test",
      policy: { ...admissionPolicy, maxConnections: 0 },
    }),
  ).toThrow("Invalid transport admission configuration");
  expect(() =>
    createRedisTransportAdmission({
      url: {
        reveal: () => {
          throw new Error("private-connection-material");
        },
      },
      namespace: "test",
      policy: admissionPolicy,
    }),
  ).toThrow("Transport admission client configuration is invalid");
});

import { describe, expect, it } from "vitest";
import {
  createBrowserPolicy,
  parseBrowserPolicyArtifact,
  verifyBrowserPolicyArtifact,
  type BrowserPolicyInput,
} from "../../security/browser-policy.js";
import { telegramSdkIntegrity } from "../../src/platform/telegram-sdk.js";

const input: BrowserPolicyInput = {
  profile: "production",
  webOrigin: "https://mini.example",
  apiOrigin: "https://api.example:8443",
  frameAncestors: ["https://web.telegram.org"],
};
const make = (patch: Partial<BrowserPolicyInput> = {}) =>
  createBrowserPolicy({ ...input, ...patch }, telegramSdkIntegrity);

describe("static Mini App browser policy", () => {
  it("allows only self scripts and the reviewed external SDK hash, with no inline scripts or eval", () => {
    const policy = make();
    const csp = policy.headers["Content-Security-Policy"]!;
    expect(csp).toContain(`script-src 'self' '${telegramSdkIntegrity}'`);
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).not.toMatch(/unsafe-eval|report-uri|report-to|report-sample|\*/);
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });
  it("pins HTTP and explicit WebSocket destinations without expanding trust to all HTTPS hosts", () => {
    const csp = make().headers["Content-Security-Policy"]!;
    expect(csp).toContain(
      "connect-src 'self' https://mini.example wss://mini.example https://api.example:8443 wss://api.example:8443;",
    );
    expect(csp).toContain("frame-ancestors https://web.telegram.org");
    expect(csp).not.toContain("connect-src https:");
    expect(csp).toContain("img-src 'self' https://t.me;");
  });
  it("provides a fail-closed same-origin baseline when deployment origins are not selected", () => {
    const policy = make({ webOrigin: null, apiOrigin: null, frameAncestors: [] });
    expect(policy.headers["Content-Security-Policy"]).toContain("connect-src 'self';");
    expect(policy.headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });
  it("disables unused capabilities and credential-bearing referrers, without conflicting frame headers", () => {
    const headers = make().headers;
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Permissions-Policy"]).toContain("microphone=()");
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(headers["X-Frame-Options"]).toBeUndefined();
    expect(Object.isFrozen(headers)).toBe(true);
  });
  it.each([
    "http://api.example",
    "https://user:credential@api.example",
    "https://api.example/path",
    "https://api.example/",
    "https://api.example?credential=synthetic",
    "https://api.example#fragment",
    "https://*.example",
    "https://api.example;script-src *",
    "https://api.example\r\nInjected: synthetic",
    "https://API.example",
    "wss://api.example",
    "null",
  ])("rejects a noncanonical/insecure/injected production destination (%s)", (value) => {
    expect(() => make({ apiOrigin: value })).toThrow("INVALID_WEB_BROWSER_POLICY");
    expect(() => make({ webOrigin: value })).toThrow("INVALID_WEB_BROWSER_POLICY");
    expect(() => make({ frameAncestors: [value] })).toThrow("INVALID_WEB_BROWSER_POLICY");
  });
  it("bounds and deduplicates the explicit ancestor list", () => {
    expect(() => make({ frameAncestors: Array(17).fill("https://web.telegram.org") })).toThrow();
    expect(() =>
      make({ frameAncestors: ["https://web.telegram.org", "https://web.telegram.org"] }),
    ).toThrow();
    expect(() => make({ frameAncestors: "*" as unknown as string[] })).toThrow();
  });
  it("requires a loopback web origin for the explicitly selected test profile", () => {
    const local = {
      profile: "loopback-test" as const,
      webOrigin: "http://127.0.0.1:4173",
      apiOrigin: "http://127.0.0.1:4174",
      frameAncestors: ["https://web.telegram.org"],
    };
    const policy = make(local);
    expect(policy.headers["Strict-Transport-Security"]).toBeUndefined();
    expect(policy.headers["Content-Security-Policy"]).toContain("ws://127.0.0.1:4174");
    expect(() => make({ ...local, webOrigin: null })).toThrow();
    expect(() => make({ ...local, apiOrigin: "https://remote.example" })).toThrow();
    expect(() => make({ ...local, webOrigin: "http://127.0.0.2:4173" })).toThrow();
  });
  it("rejects missing/changed SDK pins and modified, extra or old artifact data", () => {
    const policy = make();
    expect(
      verifyBrowserPolicyArtifact(JSON.parse(JSON.stringify(policy)), telegramSdkIntegrity),
    ).toEqual(policy);
    expect(() => createBrowserPolicy(input, "sha384-invalid")).toThrow();
    expect(() =>
      verifyBrowserPolicyArtifact({ ...policy, schemaVersion: 2 }, telegramSdkIntegrity),
    ).toThrow();
    expect(() =>
      verifyBrowserPolicyArtifact(
        { ...policy, headers: { ...policy.headers, "Content-Security-Policy": "script-src *" } },
        telegramSdkIntegrity,
      ),
    ).toThrow();
    expect(() =>
      verifyBrowserPolicyArtifact({ ...policy, extra: "synthetic" }, telegramSdkIntegrity),
    ).toThrow();
    expect(() => verifyBrowserPolicyArtifact(policy, "sha384-" + "A".repeat(64))).toThrow();
  });
  it("bounds artifact parsing and emits only a fixed error without untrusted input", () => {
    expect(parseBrowserPolicyArtifact(JSON.stringify(make()), telegramSdkIntegrity)).toEqual(
      make(),
    );
    for (const raw of [
      '{"private":"SYNTHETIC_ARTIFACT_CREDENTIAL_CANARY",',
      "SYNTHETIC_ARTIFACT_CREDENTIAL_CANARY".repeat(1000),
      JSON.stringify({ private: "SYNTHETIC_ARTIFACT_CREDENTIAL_CANARY" }),
    ]) {
      try {
        parseBrowserPolicyArtifact(raw, telegramSdkIntegrity);
        expect.fail("Invalid artifact was accepted");
      } catch (error) {
        expect((error as Error).message).toBe("INVALID_WEB_BROWSER_POLICY");
      }
    }
  });
});

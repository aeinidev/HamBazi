import { describe, it, expect, vi, afterEach } from "vitest";
import { adminRequest } from "../../src/platform/http.js";
afterEach(() => vi.unstubAllGlobals());
describe("Admin browser transport", () => {
  it("uses same-origin cookies, no cache and CSRF without bearer credentials", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await adminRequest(
      "auth/logout",
      { schemaVersion: 1, commandId: "synthetic" },
      "synthetic-csrf",
    );
    expect(fetch.mock.calls[0]![0]).toBe("/v1/admin/auth/logout");
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "synthetic-csrf" },
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("Authorization");
  });
  it("does not expose unexpected server diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("private diagnostic", { status: 503 })),
    );
    await expect(adminRequest("overview")).rejects.toBeDefined();
  });
});

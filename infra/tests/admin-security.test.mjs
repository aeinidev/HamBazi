import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
const now = Date.parse("2026-10-25T12:00:00Z") / 1000;
const fixture = () => ({
  now,
  image: `sha256:${"a".repeat(64)}`,
  core: "2026-10-26T11:00:00Z",
  metadata: { Version: 2, UpdatedAt: "2026-10-25T10:00:00Z", DownloadedAt: "2026-10-25T11:00:00Z" },
  report: {
    SchemaVersion: 2,
    ArtifactName: `sha256:${"a".repeat(64)}`,
    Results: [{ Class: "os-pkgs" }],
  },
});
const assess = (v) =>
  execFileSync(
    "python3",
    [
      "-c",
      "import runpy,json,sys;m=runpy.run_path('infra/scripts/admin-security.py');v=json.loads(sys.argv[1]);print(m['scan_deadline'](v['metadata'],v['report'],v['image'],v['core'],v['now']))",
      JSON.stringify(v),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
describe("private Admin release evidence", () => {
  it("requires the public certificate receipt to match the currently validated live leaf", () => {
    const run = (patch) =>
      execFileSync(
        "python3",
        [
          "-c",
          `import runpy,json,sys;m=runpy.run_path('infra/scripts/admin-security.py');r={'hostname':'admin.hambazi.top','lineage':'hambazi-admin','validation':'system-ca+hostname+key-match+live-leaf','servedCertificateSHA256':'a'*64,'checkedAtUTC':'2026-10-25T10:00:00Z'};r.update(json.loads(sys.argv[1]));m['verify_certificate_receipt'](r,'a'*64,${now})`,
          JSON.stringify(patch),
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    expect(() => run({})).not.toThrow();
    for (const patch of [
      { hostname: "player.hambazi.top" },
      { servedCertificateSHA256: "b".repeat(64) },
      { validation: "skipped" },
      { checkedAtUTC: "2026-10-25T12:05:01Z" },
    ])
      expect(() => run(patch)).toThrow();
  });
  it("expires at the earlier genuine timestamp and never later than core infrastructure", () => {
    const f = fixture();
    expect(assess(f)).toBe("2026-10-26T10:00:00Z");
    f.core = "2026-10-25T13:00:00Z";
    expect(assess(f)).toBe(f.core);
  });
  it.each(["HIGH", "CRITICAL", "UNKNOWN", undefined])(
    "rejects unsafe or unknown severity %s",
    (severity) => {
      const f = fixture();
      f.report.Results[0].Vulnerabilities = [{ Severity: severity }];
      expect(() => assess(f)).toThrow();
    },
  );
  it("allows the existing Moderate policy without changing the expiry", () => {
    const f = fixture();
    f.report.Results[0].Vulnerabilities = [{ Severity: "MEDIUM" }];
    expect(assess(f)).toBe("2026-10-26T10:00:00Z");
  });
  it("rejects stale/future evidence, wrong images, empty reports and expired core", () => {
    for (const mutate of [
      (f) => {
        f.metadata.UpdatedAt = "2026-10-24T11:00:00Z";
      },
      (f) => {
        f.metadata.DownloadedAt = "2026-10-25T12:05:01Z";
      },
      (f) => {
        f.report.ArtifactName = "other";
      },
      (f) => {
        f.report.Results = [];
      },
      (f) => {
        f.core = "2026-10-25T12:14:59Z";
      },
    ]) {
      const f = fixture();
      mutate(f);
      expect(() => assess(f)).toThrow();
    }
  });
});

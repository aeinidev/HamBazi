import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const now = Date.parse("2026-10-20T14:00:00Z") / 1000;
const roles = ["api", "bot", "worker", "web", "postgres-staging", "redis-staging"];
const fixture = () => {
  const pins = Object.fromEntries(roles.map((role) => [role, `${role}@sha256:${"a".repeat(64)}`]));
  return {
    now,
    metadata: {
      Version: 2,
      UpdatedAt: "2026-10-20T13:00:00Z",
      DownloadedAt: "2026-10-20T13:30:00Z",
    },
    pins,
    reports: Object.fromEntries(
      roles.map((role) => [
        role,
        { SchemaVersion: 2, ArtifactName: pins[role], Results: [{ Class: "os-pkgs" }] },
      ]),
    ),
  };
};
const assess = (value) =>
  execFileSync(
    "python3",
    [
      "-c",
      "import runpy,json,sys;m=runpy.run_path('infra/scripts/replacement-security.py');v=json.loads(sys.argv[1]);print(m['normal_expiry'](v['metadata'],v['reports'],v['pins'],v['now']))",
      JSON.stringify(value),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

describe("replacement server normal security renewal", () => {
  it("fetches advisories despite a future cached NextUpdate and preserves cache on download failure", () => {
    const result = execFileSync(
      "python3",
      [
        "-c",
        `
import importlib.util,json,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('security','infra/scripts/replacement-security.py')
s=importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
with tempfile.TemporaryDirectory() as root:
    s.ROOT=Path(root)
    cache=s.ROOT/'cache'
    (cache/'db').mkdir(parents=True)
    (cache/'db/metadata.json').write_text('{"NextUpdate":"2099-01-01T00:00:00Z"}')
    (cache/'db/trivy.db').write_text('old')
    def download(args, timeout):
        destination=Path(args[args.index('--cache-dir')+1])
        assert destination != cache and not (destination/'db').exists()
        assert args[args.index('--db-repository')+1]=='ghcr.io/aquasecurity/trivy-db:2'
        (destination/'db').mkdir()
        (destination/'db/metadata.json').write_text('{"UpdatedAt":"2026-10-23T01:00:00Z"}')
        (destination/'db/trivy.db').write_text('fresh')
    s.run=download
    s.refresh_database('trivy',str(cache))
    assert (cache/'db/trivy.db').read_text()=='fresh'
    assert json.loads((cache/'db/metadata.json').read_text())['UpdatedAt']=='2026-10-23T01:00:00Z'
    def fail(args, timeout):
        raise RuntimeError('download unavailable')
    s.run=fail
    try:
        s.refresh_database('trivy',str(cache))
        raise AssertionError('failure must propagate')
    except RuntimeError:
        pass
    assert (cache/'db/trivy.db').read_text()=='fresh'
    assert list(s.ROOT.iterdir())==[cache]
print('passed')
`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    expect(result).toBe("passed");
  });
  it("uses the earlier genuine timestamp and never download time alone", () => {
    expect(assess(fixture())).toBe("2026-10-21T13:00:00Z");
    const v = fixture();
    v.metadata.DownloadedAt = "2026-10-20T14:00:00Z";
    expect(assess(v)).toBe("2026-10-21T13:00:00Z");
  });
  it.each(["HIGH", "CRITICAL", "UNKNOWN", "NEGLIGIBLE", "unrecognized"])(
    "blocks %s findings",
    (severity) => {
      const v = fixture();
      v.reports.api.Results[0].Vulnerabilities = [{ Severity: severity }];
      expect(() => assess(v)).toThrow();
    },
  );
  it("retains the existing allowance for Moderate findings", () => {
    const v = fixture();
    v.reports.api.Results[0].Vulnerabilities = [{ Severity: "MEDIUM" }];
    expect(assess(v)).toBe("2026-10-21T13:00:00Z");
  });
  it("rejects stale or future advisory data", () => {
    const v = fixture();
    v.metadata.UpdatedAt = "2026-10-19T14:00:00Z";
    expect(() => assess(v)).toThrow();
    v.metadata.UpdatedAt = "2026-10-20T14:05:01Z";
    expect(() => assess(v)).toThrow();
  });
  it("rejects missing, substituted and unscanned images", () => {
    const v = fixture();
    delete v.reports.bot;
    expect(() => assess(v)).toThrow();
    const changed = fixture();
    changed.reports.api.ArtifactName = "api@sha256:unreviewed";
    expect(() => assess(changed)).toThrow();
    const empty = fixture();
    empty.reports.api.Results = [];
    expect(() => assess(empty)).toThrow();
  });
});

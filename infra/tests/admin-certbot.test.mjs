import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
function testHook(scenario) {
  return JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        `
import runpy,json,sys,hashlib
m=runpy.run_path('infra/scripts/admin-certbot-hook.py');s=sys.argv[1];calls=[];saved=[]
def run(args,data=None):
 calls.append(args)
 if s=='untrusted' and args[:2]==['openssl','verify']: raise ValueError('TEST_UNTRUSTED')
 if s=='expired' and '-checkend' in args: raise ValueError('TEST_EXPIRED')
 if args[:2]==['nginx','-t'] and s=='invalid-nginx': raise ValueError('TEST_NGINX')
 if '-pubkey' in args: return b'public-pem'
 if args[:2]==['openssl','pkey']: return b'wrong-key' if s=='wrong-key' and '-in' in args else b'public-der'
 return b'certificate-der'
def check():
 if s=='unsafe-files': raise ValueError('TEST_METADATA')
def probe(): return 'wrong' if s=='old-live-leaf' else hashlib.sha256(b'certificate-der').hexdigest()
try:
 result=m['deploy']('/etc/letsencrypt/live/player' if s=='other-lineage' else str(m['LINEAGE']),run,check,probe,saved.append)
 print(json.dumps({'ok':True,'acted':result,'calls':calls,'saved':saved}))
except Exception: print(json.dumps({'ok':False,'calls':calls,'saved':saved}))
`,
        scenario,
      ],
      { encoding: "utf8" },
    ),
  );
}
describe("candidate Admin certificate deploy hook", () => {
  it("validates chain/SAN/expiry/key and served leaf before recording renewal", () => {
    const r = testHook("valid");
    expect(r.ok).toBe(true);
    expect(r.saved).toHaveLength(1);
    expect(r.calls).toContainEqual(["nginx", "-t"]);
    expect(r.calls).toContainEqual(["systemctl", "reload", "nginx"]);
    expect(r.calls[0]).toContain("-verify_hostname");
    expect(r.calls[0]).toContain("admin.hambazi.top");
    expect(r.saved[0].validation).toBe("system-ca+hostname+key-match+live-leaf");
  });
  it("leaves all player certificates alone", () => {
    const r = testHook("other-lineage");
    expect(r.acted).toBe(false);
    expect(r.calls).toHaveLength(0);
    expect(r.saved).toHaveLength(0);
  });
  it.each(["untrusted", "expired", "wrong-key", "unsafe-files", "invalid-nginx", "old-live-leaf"])(
    "does not report success for %s",
    (scenario) => {
      const r = testHook(scenario);
      expect(r.ok).toBe(false);
      expect(r.saved).toHaveLength(0);
      if (scenario !== "old-live-leaf")
        expect(r.calls).not.toContainEqual(["systemctl", "reload", "nginx"]);
    },
  );
});

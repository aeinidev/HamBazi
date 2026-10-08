import { readFile } from "node:fs/promises";
import { verifyTelegramSdkAsset } from "../security/telegram-sdk-asset.js";
import { resolve } from "node:path";
import { loadEnv, type Plugin, type ResolvedConfig } from "vite";
import { createBrowserPolicy, parseBrowserPolicyArtifact } from "../security/browser-policy.js";
import { telegramSdkIntegrity, telegramSdkUrl } from "../src/platform/telegram-sdk.js";

export function browserPolicyPlugin(): Plugin {
  let config: ResolvedConfig;
  let policy: ReturnType<typeof createBrowserPolicy>;
  return {
    name: "hambazi-browser-policy",
    async configResolved(resolved) {
      config = resolved;
      if (config.command !== "build") return;
      try {
        const sdk = await readFile(resolve(config.root, "public", telegramSdkUrl.slice(1)));
        verifyTelegramSdkAsset(sdk);
        const env = loadEnv(config.mode, config.envDir, "");
        const profile = env.HAMBAZI_WEB_POLICY_PROFILE ?? "production";
        if (profile !== "production" && profile !== "loopback-test") throw new Error();
        policy = createBrowserPolicy(
          {
            profile,
            webOrigin: env.HAMBAZI_WEB_ORIGIN || null,
            apiOrigin: env.VITE_API_ORIGIN || null,
            frameAncestors: JSON.parse(env.HAMBAZI_WEB_FRAME_ANCESTORS ?? "[]"),
          },
          telegramSdkIntegrity,
        );
      } catch {
        throw new Error("INVALID_WEB_BROWSER_POLICY");
      }
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "security-headers.json",
        source: JSON.stringify(policy, null, 2) + "\n",
      });
    },
    async configurePreviewServer(server) {
      let verified: ReturnType<typeof createBrowserPolicy>;
      try {
        const raw = await readFile(
          resolve(config.root, config.build.outDir, "security-headers.json"),
          "utf8",
        );
        verified = parseBrowserPolicyArtifact(raw, telegramSdkIntegrity);
        if (
          verified.profile === "loopback-test" &&
          !["127.0.0.1", "localhost", "::1", "[::1]"].includes(String(server.config.preview.host))
        )
          throw new Error();
      } catch {
        throw new Error("INVALID_WEB_BROWSER_POLICY");
      }
      // Vite's static middleware applies these after its own cache defaults.
      server.config.preview.headers = { ...verified.headers };
      server.middlewares.use((_request, response, next) => {
        for (const [name, value] of Object.entries(verified.headers))
          response.setHeader(name, value);
        next();
      });
    },
  };
}

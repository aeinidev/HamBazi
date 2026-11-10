export interface BrowserPolicyInput {
  profile: "production" | "loopback-test";
  webOrigin: string | null;
  apiOrigin: string | null;
  frameAncestors: readonly string[];
}

function invalid(): never {
  throw new Error("INVALID_WEB_BROWSER_POLICY");
}

function origin(value: unknown, profile: BrowserPolicyInput["profile"]): string {
  if (typeof value !== "string" || value.length > 256) return invalid();
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || /[\s*;,]/.test(value))
    return invalid();
  if (profile === "production") {
    if (url.protocol !== "https:") return invalid();
  } else if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    return invalid();
  return value;
}

// The caller supplies the single reviewed SDK pin, never an environment value.
export function createBrowserPolicy(input: BrowserPolicyInput, sdkIntegrity: string) {
  try {
    if (
      !["production", "loopback-test"].includes(input.profile) ||
      !/^sha384-[A-Za-z0-9+/]{64}$/.test(sdkIntegrity) ||
      !Array.isArray(input.frameAncestors) ||
      input.frameAncestors.length > 16
    )
      return invalid();
    const webOrigin = input.webOrigin === null ? null : origin(input.webOrigin, input.profile);
    const apiOrigin = input.apiOrigin === null ? null : origin(input.apiOrigin, input.profile);
    if (input.profile === "loopback-test" && webOrigin === null) return invalid();
    const ancestors = input.frameAncestors.map((value) =>
      origin(
        value,
        input.profile === "loopback-test" && new URL(value).protocol === "https:"
          ? "production"
          : input.profile,
      ),
    );
    if (new Set(ancestors).size !== ancestors.length) return invalid();
    const connect = new Set(["'self'"]);
    for (const value of [webOrigin, apiOrigin]) {
      if (!value) continue;
      connect.add(value);
      const socket = new URL(value);
      socket.protocol = socket.protocol === "https:" ? "wss:" : "ws:";
      connect.add(socket.origin);
    }
    const csp = [
      "default-src 'none'",
      // CSP external hashes require matching integrity metadata on the SDK tag.
      `script-src 'self' '${sdkIntegrity}'`,
      "script-src-attr 'none'",
      // Telegram's iframe custom style and dynamic theme CSS require inline styles.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' https://t.me data: blob:",
      "font-src 'self'",
      `connect-src ${[...connect].join(" ")}`,
      "object-src 'none'",
      "frame-src 'none'",
      "worker-src blob:",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${ancestors.length ? ancestors.join(" ") : "'none'"}`,
    ].join("; ");
    const headers: Record<string, string> = {
      "Content-Security-Policy": csp,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "Cache-Control": "no-store",
    };
    if (input.profile === "production") headers["Strict-Transport-Security"] = "max-age=31536000";
    // Do not emit DENY/SAMEORIGIN: these conflict with approved Telegram framing.
    return Object.freeze({
      schemaVersion: 1 as const,
      profile: input.profile,
      webOrigin,
      apiOrigin,
      frameAncestors: Object.freeze(ancestors),
      headers: Object.freeze(headers),
    });
  } catch {
    return invalid();
  }
}

export function verifyBrowserPolicyArtifact(value: unknown, sdkIntegrity: string) {
  try {
    const input = value as BrowserPolicyInput;
    const expected = createBrowserPolicy(input, sdkIntegrity);
    if (JSON.stringify(value) !== JSON.stringify(expected)) return invalid();
    return expected;
  } catch {
    return invalid();
  }
}

export function parseBrowserPolicyArtifact(raw: string, sdkIntegrity: string) {
  try {
    if (typeof raw !== "string" || raw.length > 16384) return invalid();
    return verifyBrowserPolicyArtifact(JSON.parse(raw), sdkIntegrity);
  } catch {
    return invalid();
  }
}

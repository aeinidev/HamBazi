// Temporary staging diagnostics contain only fixed states and presence flags.
// Never add launch values, URLs, identities, tokens or raw browser/server errors.
export type TelegramLoaderState =
  "available" | "privacy-guard-failed" | "sdk-error" | "sdk-timeout";
export interface TelegramStartup {
  sdkPresent: boolean;
  launchDataPresent: boolean;
  initialization: "ready" | "missing-launch" | Exclude<TelegramLoaderState, "available">;
}
export interface TelegramDiagnostics extends TelegramStartup {
  authentication:
    "not-requested" | "pending" | "authenticated" | "failed" | "expired" | "signed-out";
  errorCode: string | null;
}
const safeCodes = new Set([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_INPUT",
  "RATE_LIMITED",
  "NETWORK_ERROR",
  "INVALID_RESPONSE",
  "INTERNAL_ERROR",
]);
export function diagnosticErrorCode(code: unknown): string {
  return typeof code === "string" && safeCodes.has(code) ? code : "INTERNAL_ERROR";
}
export function hasTelegramLaunchData(href: string): boolean {
  try {
    const url = new URL(href);
    const fragment = url.hash.slice(1);
    const queryStart = fragment.indexOf("?");
    const fields = new URLSearchParams(queryStart >= 0 ? fragment.slice(queryStart + 1) : fragment);
    return !!fields.get("tgWebAppData") || !!url.searchParams.get("tgWebAppData");
  } catch {
    return false;
  }
}

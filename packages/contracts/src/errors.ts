import type { ErrorCode } from "@hambazi/shared";

/** Unknown future codes are allowed on receipt; clients must have a generic fallback. */
export interface ErrorEnvelope<Code extends string = string> {
  readonly ok: false;
  readonly error: {
    readonly code: Code;
    readonly message: string;
    readonly retryable: boolean;
  };
}

const definitions = {
  INVALID_INPUT: { message: "Invalid input", retryable: false },
  UNAUTHENTICATED: { message: "Authentication required", retryable: false },
  FORBIDDEN: { message: "Operation not permitted", retryable: false },
  NOT_FOUND: { message: "Resource not found", retryable: false },
  RATE_LIMITED: { message: "Request rate exceeded", retryable: true },
  GAME_STATE_CONFLICT: { message: "Client state is stale", retryable: true },
  PROFILE_CONFLICT: { message: "Profile edit conflicts with current state", retryable: false },
  ROOM_CONFLICT: { message: "Room command conflicts with current state", retryable: false },
  GAME_UNAVAILABLE: { message: "Game admission is unavailable", retryable: false },
  CLIENT_UPGRADE_REQUIRED: { message: "Client upgrade required", retryable: false },
  INTERNAL_ERROR: { message: "Operation failed", retryable: false },
} as const satisfies Record<ErrorCode, { message: string; retryable: boolean }>;

/** No arbitrary message, cause, validation issue, or rejected value can be attached. */
export function createErrorEnvelope<Code extends ErrorCode>(code: Code): ErrorEnvelope<Code> {
  if (!Object.hasOwn(definitions, code)) throw new Error("Unknown public error code");
  return { ok: false, error: { code, ...definitions[code] } };
}

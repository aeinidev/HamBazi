import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import type { z } from "zod";

export type ContractParseResult<Data> =
  { readonly ok: true; readonly data: Data } | ErrorEnvelope<"INVALID_INPUT">;

/**
 * Boundary helper for synchronous schemas. Never return/log raw Zod issues:
 * they can contain sensitive values, attacker-controlled keys, or custom messages.
 * This validates shape only; authorization and game rules belong to use cases.
 */
export function parseContract<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): ContractParseResult<z.output<Schema>> {
  try {
    const result = schema.safeParse(input);
    if (result.success) return { ok: true, data: result.data };
  } catch {
    // Custom refinements may throw; do not expose their error/cause either.
  }
  return createErrorEnvelope("INVALID_INPUT");
}

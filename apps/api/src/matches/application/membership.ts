import { createErrorEnvelope, type ErrorEnvelope } from "@hambazi/contracts";
import { z } from "zod";

const reference = z.strictObject({ schemaVersion: z.literal(1), matchId: z.uuid() });
export type MatchMembership = Readonly<{
  schemaVersion: 1;
  matchId: string;
  role: "PLAYER" | "SPECTATOR";
}>;
export interface MatchMembershipRepository {
  find(userId: string, matchId: string): Promise<MatchMembership | null>;
}
export function matchMembershipService(repository: MatchMembershipRepository) {
  return Object.freeze({
    async authorize(
      identity: unknown,
      input: unknown,
    ): Promise<{ ok: true; value: MatchMembership } | ErrorEnvelope> {
      const actor = z.uuid().safeParse(identity);
      const target = reference.safeParse(input);
      if (!actor.success) return createErrorEnvelope("UNAUTHENTICATED");
      if (!target.success) return createErrorEnvelope("INVALID_INPUT");
      try {
        const membership = await repository.find(actor.data, target.data.matchId);
        return membership ? { ok: true, value: membership } : createErrorEnvelope("NOT_FOUND");
      } catch {
        return createErrorEnvelope("INTERNAL_ERROR");
      }
    },
  });
}
export type MatchMembershipPort = ReturnType<typeof matchMembershipService>;

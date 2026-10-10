import {
  coupAnarchistPlayerViewSchema,
  coupAnarchistSpectatorViewSchema,
} from "@hambazi/coup-engine";
import { createErrorEnvelope } from "@hambazi/contracts";
import { matchSnapshotSchema, type createPersonalMatchPort } from "../matches/index.js";
import type { PublicNamesPort } from "../users/index.js";
/** Resolve public display metadata through Users after the locked Match read, never inside its transaction. */
export function withPersonalPublicNames(
  port: ReturnType<typeof createPersonalMatchPort>,
  names: PublicNamesPort,
) {
  async function enrich(result: Awaited<ReturnType<typeof port.read>>) {
    if (!result.ok) return result;
    try {
      const snapshot = matchSnapshotSchema.parse(result.value);
      if (snapshot.engineVersion !== "coup-anarchist-v1" || snapshot.view === null) return result;
      const schema =
        snapshot.role === "PLAYER"
          ? coupAnarchistPlayerViewSchema
          : coupAnarchistSpectatorViewSchema;
      const view = schema.parse(snapshot.view);
      const publicNames = new Map(
        (await names.find(view.players.map((p) => p.id))).map((p) => [p.userId, p.displayName]),
      );
      return {
        ok: true as const,
        value: {
          ...snapshot,
          view: schema.parse({
            ...view,
            players: view.players.map((p) => {
              const displayName = publicNames.get(p.id);
              return displayName ? { ...p, displayName } : p;
            }),
          }),
        },
      };
    } catch {
      return createErrorEnvelope("INTERNAL_ERROR");
    }
  }
  return Object.freeze({
    ...port,
    start: async (...args: Parameters<typeof port.start>) => enrich(await port.start(...args)),
    read: async (...args: Parameters<typeof port.read>) => enrich(await port.read(...args)),
  });
}

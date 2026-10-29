/** Instantiate per authenticated identity and Match; discard on logout/role change. */
export function createMatchSequence(matchId: string) {
  let stateVersion = -1;
  let snapshotSeq = -1;
  let eventSeq = -1;
  let needsResync = true;
  const valid = (value: number) => Number.isInteger(value) && value >= 0 && value <= 2147483647;
  return Object.freeze({
    event(input: {
      schemaVersion: number;
      matchId: string;
      seq: number;
    }): "DUPLICATE" | "GAP" | "ACCEPT" | "INVALID" {
      if (
        input.schemaVersion !== 1 ||
        input.matchId !== matchId ||
        !valid(input.seq) ||
        input.seq === 0
      )
        return "INVALID";
      if (input.seq <= eventSeq) return "DUPLICATE";
      if (eventSeq < 0 || input.seq !== eventSeq + 1) {
        eventSeq = input.seq; // An older in-flight snapshot must not erase a known gap.
        needsResync = true;
        return "GAP";
      }
      eventSeq = input.seq;
      needsResync = true; // An invalidation never substitutes for a renderable view.
      return "ACCEPT";
    },
    snapshot(input: {
      schemaVersion: number;
      matchId: string;
      stateVersion: number;
      lastEventSeq: number;
    }): "APPLY" | "STALE" | "INVALID" {
      if (
        input.schemaVersion !== 1 ||
        input.matchId !== matchId ||
        !valid(input.stateVersion) ||
        !valid(input.lastEventSeq)
      )
        return "INVALID";
      if (input.stateVersion <= stateVersion || input.lastEventSeq < snapshotSeq) return "STALE";
      stateVersion = input.stateVersion;
      snapshotSeq = input.lastEventSeq;
      eventSeq = Math.max(eventSeq, snapshotSeq);
      needsResync = snapshotSeq < eventSeq;
      return "APPLY";
    },
    cursor: () => ({ stateVersion, lastEventSeq: Math.max(0, snapshotSeq), needsResync }),
  });
}

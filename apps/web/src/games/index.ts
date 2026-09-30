import type { Snapshot } from "../platform/contracts.js";
import { toCoupView } from "./coup/index.js";

// Keep only a validated public projection in the session store.
export function publicSnapshot(snapshot: Snapshot, viewerId: string): Snapshot {
  if (snapshot.gameId === "coup") return { ...snapshot, view: toCoupView(snapshot, viewerId) };
  return { ...snapshot, view: null };
}

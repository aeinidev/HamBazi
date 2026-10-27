/** Content-free identity/evidence plus the validated intent, passed only by trusted server composition. */
export interface AdminEffectCommand {
  id: string;
  actorId: string;
  realmId: string;
  digest: string;
  gameId: string | null;
  action: {
    operation: string;
    targetId: string;
    expectedVersion: number;
    displayName?: string;
    status?: string;
  };
}

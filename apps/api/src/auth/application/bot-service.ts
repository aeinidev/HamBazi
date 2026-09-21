/** Service authority only. This is deliberately not a player SessionContext. */
export interface BotServiceContext {
  readonly schemaVersion: 1;
  readonly botId: string;
  readonly scope: "bot:onboarding";
}

export interface BotServiceAuthenticator {
  /** Supply original raw header pairs and socket.remoteAddress, never forwarded identity. */
  authenticate(input: {
    rawHeaders: readonly string[];
    remoteAddress: string | undefined;
    requiredScope: string;
  }): BotServiceContext | undefined;
}

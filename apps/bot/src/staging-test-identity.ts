import { mapUpdate } from "./updates.js";
import { z } from "zod";

const identity = z.object({
  message: z.object({
    date: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    from: z.object({ username: z.string().regex(/^[A-Za-z0-9_]{5,32}$/) }),
  }),
});
export interface ObservedTestIdentity {
  schemaVersion: 1;
  purpose: "verified-private-telegram-start";
  telegramUserId: string;
  observedUsername: string;
  botId: string;
  updateId: number;
  messageId: number;
  receivedAt: string;
}
/** Called exclusively after HTTPS webhook secret/admission checks. Observation grants nothing. */
export function createStagingTestIdentityObserver(options: {
  username: string;
  botId: string;
  botUsername: string;
  now(): number;
  writeOnce(identity: ObservedTestIdentity): Promise<void>;
}) {
  const openedAt = options.now();
  return async (input: unknown) => {
    const now = options.now();
    if (now < openedAt || now > openedAt + 30 * 60 * 1000) return;
    const update = mapUpdate(input, options.botId, options.botUsername);
    const parsed = identity.safeParse(input);
    if (!update || update.action !== "START" || !parsed.success) return;
    const { date, from } = parsed.data.message;
    if (
      from.username.toLowerCase() !== options.username.toLowerCase() ||
      date * 1000 < openedAt - 5000 ||
      date * 1000 > now + 30000
    )
      return;
    await options.writeOnce({
      schemaVersion: 1,
      purpose: "verified-private-telegram-start",
      telegramUserId: update.senderId,
      observedUsername: from.username,
      botId: options.botId,
      updateId: update.updateId,
      messageId: update.messageId,
      receivedAt: new Date(now).toISOString(),
    });
  };
}

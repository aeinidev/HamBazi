import { timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";
import type { BotServiceConfig } from "@hambazi/config";
import type { BotServiceAuthenticator, BotServiceContext } from "../application/bot-service.js";

/** Requires validated API-side configuration. No network, storage or logging. */
export function botServiceBearer(config: BotServiceConfig): BotServiceAuthenticator {
  const keys = new Map(
    config.keys.map((key) => [key.id, Buffer.from(key.secret.reveal(), "base64url")]),
  );
  const peers = new BlockList();
  for (const address of config.allowedPeers)
    peers.addAddress(address, isIP(address) === 4 ? "ipv4" : "ipv6");
  const context: BotServiceContext = Object.freeze({
    schemaVersion: 1,
    botId: config.botId,
    scope: "bot:onboarding",
  });
  return Object.freeze({
    authenticate({ rawHeaders, remoteAddress, requiredScope }) {
      if (requiredScope !== context.scope || !remoteAddress || remoteAddress.includes("%"))
        return undefined;
      const family = isIP(remoteAddress);
      if (!family || !peers.check(remoteAddress, family === 4 ? "ipv4" : "ipv6")) return undefined;
      if (rawHeaders.length % 2 !== 0 || rawHeaders.length > 256) return undefined;
      let authorization: string | undefined;
      for (let i = 0; i < rawHeaders.length; i += 2) {
        if (rawHeaders[i]!.toLowerCase() !== "authorization") continue;
        if (authorization !== undefined) return undefined;
        authorization = rawHeaders[i + 1]!;
      }
      if (!authorization || authorization.length > 158) return undefined;
      const match = /^Bearer ([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{43,86})$/i.exec(authorization);
      if (!match) return undefined;
      const expected = keys.get(match[1]!);
      const supplied = Buffer.from(match[2]!, "base64url");
      if (
        !expected ||
        supplied.length !== expected.length ||
        supplied.toString("base64url") !== match[2]
      )
        return undefined;
      return timingSafeEqual(expected, supplied) ? context : undefined;
    },
  } satisfies BotServiceAuthenticator);
}

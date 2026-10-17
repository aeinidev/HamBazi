import { io } from "socket.io-client";
import { createRealtime } from "../../platform/realtime.js";
import { z } from "zod";
import { inviteSchema } from "../../platform/contracts.js";
export const kahrobaInviteSchema = inviteSchema.or(
  inviteSchema.extend({
    schemaVersion: z.literal(2),
    invite: inviteSchema.shape.invite.extend({
      startParam: z.string().regex(/^room_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048](?![\s\S])/),
      deepLink: z
        .string()
        .regex(
          /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}\?startapp=room_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048](?![\s\S])/,
        ),
    }),
  }),
);
export const createKahrobaRealtime: typeof createRealtime = (origin, token, callbacks) =>
  createRealtime(origin, token, callbacks, io, false, {
    namespace: "kahroba-v1",
    path: "/v1/kahroba/socket.io",
  });

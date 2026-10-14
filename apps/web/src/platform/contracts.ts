import { z } from "zod";
const uuid = z.uuid();
const version = z.number().int().nonnegative();
export const sessionSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: uuid,
  userId: uuid,
  expiresAt: version,
});
export const issuedSchema = z.object({
  schemaVersion: z.literal(1),
  tokenType: z.literal("Bearer"),
  accessToken: z.string().min(1).max(4096),
  session: sessionSchema,
  photoUrl: z.url().optional(),
});
export const accountSchema = z.object({
  schemaVersion: z.literal(1),
  account: z.object({
    schemaVersion: z.literal(1),
    userId: uuid,
    displayName: z.string(),
    publicHandle: z.string(),
  }),
  startParam: z.string().optional(),
});
export const settingsSchema = z.object({
  locale: z.enum(["auto", "fa", "en"]),
  theme: z.enum(["system", "light", "dark"]),
});
export const profileSchema = z.object({
  schemaVersion: z.literal(1),
  userId: uuid,
  displayName: z.string(),
  publicHandle: z.string(),
  version,
  settings: settingsSchema,
});
export const profileAckSchema = z.object({
  schemaVersion: z.literal(1),
  commandId: uuid,
  appliedVersion: version,
});
export const gameSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  minPlayers: z.number().int().min(2).max(64),
  maxPlayers: z.number().int().min(2).max(64),
  status: z.enum(["ACTIVE", "MAINTENANCE", "DISABLED"]),
  playable: z.boolean(),
  matchmakingEnabled: z.boolean(),
  privateRoomsEnabled: z.boolean(),
  chatEnabled: z.boolean(),
  voiceEnabled: z.boolean(),
  matchmakingModes: z
    .array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), title: z.string().min(1) }))
    .optional(),
});
export const catalogSchema = z.object({
  schemaVersion: z.literal(1),
  games: z.array(gameSchema),
});
export const lobbyAvailabilitySchema = z.object({
  schemaVersion: z.literal(1),
  lobbyAvailability: z.array(
    z.object({
      id: z.enum(["kahroba", "hokm", "domino", "chess", "ludo", "coup"]),
      state: z.enum(["AVAILABLE", "COMING_SOON", "TEMPORARILY_DISABLED"]),
    }),
  ),
});
export const gameResponseSchema = z.object({ schemaVersion: z.literal(1), game: gameSchema });
export const roomSchema = z.object({
  id: uuid,
  gameId: z.string(),
  hostUserId: uuid,
  capacity: version,
  version,
  status: z.enum(["WAITING", "FULL", "STARTING", "STARTED", "CLOSED", "EXPIRED"]),
  expiresAt: version,
  startedMatchId: uuid.nullable(),
  members: z.array(
    z.object({ userId: uuid, seat: version, joinedAt: version, joinedVersion: version }),
  ),
});
export const roomResponseSchema = z.object({
  ok: z.literal(true),
  schemaVersion: z.literal(1),
  room: roomSchema,
});
export const roomAckSchema = z.object({
  ok: z.literal(true),
  schemaVersion: z.literal(1),
  commandId: uuid,
  roomId: uuid,
  appliedVersion: version,
});
export const previewSchema = z.object({
  ok: z.literal(true),
  schemaVersion: z.literal(1),
  room: roomSchema.pick({
    id: true,
    gameId: true,
    capacity: true,
    version: true,
    expiresAt: true,
    status: true,
  }),
});
export const inviteSchema = z.object({
  ok: z.literal(true),
  schemaVersion: z.literal(1),
  invite: z.object({
    roomId: uuid,
    expiresAt: version,
    startParam: z.string(),
    deepLink: z
      .string()
      .regex(
        /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}\/[A-Za-z0-9_]{1,64}\?startapp=room_[A-Za-z0-9_-]{43}$/,
      ),
  }),
});
export const ticketSchema = z.object({
  schemaVersion: z.literal(1),
  ticketId: uuid,
  status: z.enum(["SEARCHING", "RESERVED", "MATCHED", "CANCELLED", "EXPIRED"]),
  expiresAt: version,
  matchId: uuid.nullable(),
});
export const foundSchema = z.object({
  schemaVersion: z.literal(1),
  ticketId: uuid,
  matchId: uuid,
  admissionToken: z.string(),
  expiresAt: version,
});
export const okValue = <T extends z.ZodType>(schema: T) =>
  z.object({ ok: z.literal(true), value: schema });
export const memberSchema = z.object({
  schemaVersion: z.literal(1),
  matchId: uuid,
  role: z.enum(["PLAYER", "SPECTATOR"]),
});
export type Game = z.infer<typeof gameSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Ticket = z.infer<typeof ticketSchema>;
export const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  matchId: uuid,
  stateVersion: version,
  lastEventSeq: version,
  status: z.enum([
    "CREATED",
    "WAITING_FOR_PLAYERS",
    "READY",
    "STARTING",
    "ACTIVE",
    "FINISHED",
    "TERMINATED",
  ]),
  role: z.enum(["PLAYER", "SPECTATOR"]),
  gameId: z.string(),
  engineVersion: z.string(),
  stateSchemaVersion: version,
  rulesetVersion: z.string(),
  view: z.json().nullable(),
});
export const eventSchema = z.object({
  schemaVersion: z.literal(1),
  matchId: uuid,
  eventId: uuid,
  seq: version,
  stateVersion: version,
  type: z.literal("MATCH_INVALIDATED_V1"),
  payload: z.object({}),
});
export const catchupSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(["EVENTS", "SNAPSHOT"]),
  events: z.array(eventSchema).max(100),
  snapshot: snapshotSchema,
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const matchReferenceSchema = z.object({ schemaVersion: z.literal(1), matchId: uuid });

export const matchAckSchema = snapshotSchema
  .pick({
    schemaVersion: true,
    matchId: true,
    stateVersion: true,
    lastEventSeq: true,
    status: true,
  })
  .extend({ actionId: uuid });

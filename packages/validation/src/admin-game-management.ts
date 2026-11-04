import { z } from "zod";

const id = z.uuid();
const slug = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const counter = z.number().int().min(0).max(2147483647);
const timestamp = z.iso.datetime();
const gameStatus = z.enum(["ACTIVE", "MAINTENANCE", "DISABLED"]);
const roomStatus = z.enum(["WAITING", "FULL", "STARTING", "STARTED", "CLOSED", "EXPIRED"]);
const matchStatus = z.enum([
  "CREATED",
  "WAITING_FOR_PLAYERS",
  "READY",
  "STARTING",
  "ACTIVE",
  "FINISHED",
  "TERMINATED",
]);
const limit = z
  .string()
  .regex(/^(?:[1-9]|[1-4][0-9]|50)$/)
  .transform(Number)
  .optional();
const search = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^\P{Cc}+$/u);
const exactSearch = z.union([id, slug]);
const dates = { createdFrom: timestamp.optional(), createdTo: timestamp.optional() };
const chronological = (value: {
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
}) =>
  !value.createdFrom ||
  !value.createdTo ||
  Date.parse(value.createdFrom) <= Date.parse(value.createdTo);

export const adminGameSearchQuerySchema = z.strictObject({
  cursor: slug.optional(),
  limit,
  search: search.optional(),
  status: gameStatus.optional(),
  gameId: slug.optional(),
});
export const adminRoomSearchQuerySchema = z
  .strictObject({
    cursor: id.optional(),
    limit,
    search: exactSearch.optional(),
    status: roomStatus.optional(),
    gameId: slug.optional(),
    ...dates,
  })
  .refine(chronological, {
    path: ["createdTo"],
    message: "createdTo must not precede createdFrom",
  });
export const adminMatchSearchQuerySchema = z
  .strictObject({
    cursor: id.optional(),
    limit,
    search: exactSearch.optional(),
    status: matchStatus.optional(),
    gameId: slug.optional(),
    playerId: id.optional(),
    ...dates,
  })
  .refine(chronological, {
    path: ["createdTo"],
    message: "createdTo must not precede createdFrom",
  });
export const adminMatchHistoryQuerySchema = z.strictObject({
  cursor: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .transform(Number)
    .pipe(counter.positive())
    .optional(),
  limit,
});

const metadata = { schemaVersion: z.literal(1), asOf: timestamp };
export const adminGamePinsSchema = z.strictObject({
  engineVersion: z.string().min(1).max(128),
  stateSchemaVersion: counter,
  rulesetVersion: z.string().min(1).max(128),
});
export const adminGameRowSchema = z.strictObject({
  id: slug,
  slug,
  title: z.string().min(1).max(256),
  releaseStatus: gameStatus,
  admissionStatus: gameStatus,
  version: counter,
});
export const adminRoomRowSchema = z.strictObject({
  id,
  gameId: slug,
  status: roomStatus,
  version: counter,
  capacity: z.number().int().min(1).max(64),
  hostUserId: id,
  createdAt: timestamp,
  updatedAt: timestamp,
  expiresAt: timestamp,
  startedMatchId: id.nullable(),
});
export const adminMatchRowSchema = z.strictObject({
  id,
  gameId: slug,
  roomId: id.nullable(),
  matchType: z.enum(["PRIVATE_ROOM", "MATCHMAKING", "PERSONAL_BOTS_V1"]),
  status: matchStatus,
  version: counter,
  lastEventSeq: counter,
  createdAt: timestamp,
  updatedAt: timestamp,
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
  pins: adminGamePinsSchema,
});
export const adminGamePageSchema = z.strictObject({
  ...metadata,
  items: z.array(adminGameRowSchema).max(50),
  nextCursor: slug.nullable(),
});
export const adminRoomPageSchema = z.strictObject({
  ...metadata,
  items: z.array(adminRoomRowSchema).max(50),
  nextCursor: id.nullable(),
});
export const adminMatchPageSchema = z.strictObject({
  ...metadata,
  items: z.array(adminMatchRowSchema).max(50),
  nextCursor: id.nullable(),
});
export const adminGameDetailSchema = z.strictObject({
  ...metadata,
  item: adminGameRowSchema
    .extend({
      minPlayers: z.number().int().min(1).max(64),
      maxPlayers: z.number().int().min(1).max(64),
      matchmakingEnabled: z.boolean(),
      privateRoomsEnabled: z.boolean(),
      chatEnabled: z.boolean(),
      voiceEnabled: z.boolean(),
      configSchemaVersion: counter,
      // Null means no installed version is provable through the public registry.
      installedVersions: z.array(adminGamePinsSchema).max(32).nullable(),
    })
    .refine((game) => game.minPlayers <= game.maxPlayers, { path: ["maxPlayers"] }),
});
export const adminRoomDetailSchema = z.strictObject({ ...metadata, item: adminRoomRowSchema });
export const adminMatchDetailSchema = z.strictObject({ ...metadata, item: adminMatchRowSchema });

export const adminRoomPlayerSchema = z.strictObject({
  userId: id,
  seat: z.number().int().min(0).max(63),
  joinedAt: timestamp,
});
export const adminMatchPlayerSchema = z.discriminatedUnion("kind", [
  adminRoomPlayerSchema.extend({
    kind: z.literal("REGISTERED_PLAYER"),
    agentType: z.enum(["HUMAN", "BOT"]),
    connectionStatus: z.enum(["CONNECTED", "DISCONNECTED", "REPLACED_BY_BOT"]),
    connectionEpoch: counter,
    readyAt: timestamp.nullable(),
    disconnectedAt: timestamp.nullable(),
    disconnectDeadlineAt: timestamp.nullable(),
    replacedAt: timestamp.nullable(),
  }),
  z.strictObject({
    kind: z.literal("SERVER_BOT"),
    actorId: id,
    userId: z.null(),
    seat: z.number().int().min(0).max(63),
    agentType: z.literal("BOT"),
  }),
]);
export const adminRoomPlayersSchema = z.strictObject({
  ...metadata,
  roomId: id,
  items: z.array(adminRoomPlayerSchema).max(64),
});
export const adminMatchPlayersSchema = z.strictObject({
  ...metadata,
  matchId: id,
  items: z.array(adminMatchPlayerSchema).max(64),
});
export const adminMatchHistoryEventSchema = z.strictObject({
  id,
  seq: counter.positive(),
  schemaVersion: z.number().int().positive().max(2147483647),
  type: z.enum([
    "MATCH_LIFECYCLE_V1",
    "MATCH_INITIALIZED_V1",
    "MATCH_FINISHED_V1",
    "MATCH_FINISHED_V2",
    "PLAYER_DISCONNECTED_V1",
    "PLAYER_RECONNECTED_V1",
    "PLAYER_BOT_TAKEOVER_V1",
  ]),
  actorUserId: id.nullable(),
  createdAt: timestamp,
});
export const adminMatchResultPlayerSchema = z.strictObject({
  userId: id,
  placement: z.number().int().min(1).max(64).nullable(),
  winner: z.boolean().nullable(),
});
export const adminMatchHistorySchema = z.strictObject({
  ...metadata,
  matchId: id,
  items: z.array(adminMatchHistoryEventSchema).max(50),
  nextCursor: counter.positive().nullable(),
  results: z.array(adminMatchResultPlayerSchema).max(64),
});
const diagnostics = {
  ...metadata,
  id,
  gameId: slug,
  state: z.enum(["NO_SIGNAL", "SUSPECTED", "UNKNOWN"]),
};
export const adminRoomDiagnosticsSchema = z.strictObject({
  ...diagnostics,
  reason: z.enum([
    "ROOM_EXPIRED",
    "DEADLINE_NOT_ELAPSED",
    "TERMINAL",
    "NOT_APPLICABLE",
    "NO_DURABLE_DEADLINE",
  ]),
});
export const adminMatchDiagnosticsSchema = z.strictObject({
  ...diagnostics,
  reason: z.enum([
    "RECONNECT_OVERDUE",
    "DEADLINE_NOT_ELAPSED",
    "TERMINAL",
    "NOT_APPLICABLE",
    "NO_DURABLE_DEADLINE",
  ]),
});

export type AdminGameSearchQuery = z.infer<typeof adminGameSearchQuerySchema>;
export type AdminRoomSearchQuery = z.infer<typeof adminRoomSearchQuerySchema>;
export type AdminMatchSearchQuery = z.infer<typeof adminMatchSearchQuerySchema>;
export type AdminMatchHistoryQuery = z.infer<typeof adminMatchHistoryQuerySchema>;
export type AdminGamePins = z.infer<typeof adminGamePinsSchema>;
export type AdminGameRow = z.infer<typeof adminGameRowSchema>;
export type AdminRoomRow = z.infer<typeof adminRoomRowSchema>;
export type AdminMatchRow = z.infer<typeof adminMatchRowSchema>;
export type AdminGamePage = z.infer<typeof adminGamePageSchema>;
export type AdminRoomPage = z.infer<typeof adminRoomPageSchema>;
export type AdminMatchPage = z.infer<typeof adminMatchPageSchema>;
export type AdminGameDetail = z.infer<typeof adminGameDetailSchema>;
export type AdminRoomDetail = z.infer<typeof adminRoomDetailSchema>;
export type AdminMatchDetail = z.infer<typeof adminMatchDetailSchema>;
export type AdminRoomPlayer = z.infer<typeof adminRoomPlayerSchema>;
export type AdminMatchPlayer = z.infer<typeof adminMatchPlayerSchema>;
export type AdminRoomPlayers = z.infer<typeof adminRoomPlayersSchema>;
export type AdminMatchPlayers = z.infer<typeof adminMatchPlayersSchema>;
export type AdminMatchHistoryEvent = z.infer<typeof adminMatchHistoryEventSchema>;
export type AdminMatchResultPlayer = z.infer<typeof adminMatchResultPlayerSchema>;
export type AdminMatchHistory = z.infer<typeof adminMatchHistorySchema>;
export type AdminRoomDiagnostics = z.infer<typeof adminRoomDiagnosticsSchema>;
export type AdminMatchDiagnostics = z.infer<typeof adminMatchDiagnosticsSchema>;

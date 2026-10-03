import { z } from "zod";

const uuid = z.uuid().transform((value) => value.toLowerCase());
/** Trusted server projection only; never a client-supplied admission capability. */
export const roomStartSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    roomId: uuid,
    gameId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    capacity: z.number().int().min(2).max(64),
    startVersion: z.number().int().min(1).max(2147483645),
    status: z.enum(["STARTING", "STARTED", "CLOSED"]),
    startedMatchId: uuid.nullable(),
    players: z
      .array(z.strictObject({ userId: uuid, seat: z.number().int().nonnegative() }))
      .min(2)
      .max(64),
  })
  .refine(
    (value) =>
      value.players.length === value.capacity &&
      value.players.every((player, seat) => player.seat === seat) &&
      new Set(value.players.map((player) => player.userId)).size === value.capacity &&
      (value.status === "STARTING" ? value.startedMatchId === null : value.startedMatchId !== null),
  );
export type RoomStartSnapshot = z.infer<typeof roomStartSnapshotSchema>;
export const roomStartPageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  afterRoomId: uuid.optional(),
  limit: z.number().int().min(1).max(50),
});

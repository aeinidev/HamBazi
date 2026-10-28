import { randomInt, randomUUID } from "node:crypto";
import { DatabaseError, type createDatabase } from "@hambazi/database";
import {
  privateRoomMatchSchema,
  PrivateRoomMatchFault,
  type PrivateRoomMatchRepository,
  type PrivateRoomMatch,
} from "../../application/private-room.js";

export function createPrivateRoomMatchRepository(
  database: ReturnType<typeof createDatabase>,
  options: { clock: { nowMs(): number } },
): PrivateRoomMatchRepository {
  const scope = database.forModule("matches");
  type Client = Parameters<Parameters<typeof scope.transaction>[0]>[0];
  async function read(db: Client, roomId: string): Promise<PrivateRoomMatch | null> {
    const rows = await db.readPrivateRoomMatch(roomId);
    const row = rows[0];
    if (!row) return null;
    if (row.matchType !== "PRIVATE_ROOM") throw new PrivateRoomMatchFault("ROOM_CONFLICT");
    const players = rows.filter((player) => player.userId !== null);
    return privateRoomMatchSchema.parse({
      schemaVersion: 1,
      matchId: row.id,
      roomId: row.roomId,
      gameId: row.gameId,
      startVersion: row.roomStartVersion,
      stateVersion: row.stateVersion,
      status: row.status,
      descriptor: {
        engineVersion: row.engineVersion,
        stateSchemaVersion: row.stateSchemaVersion,
        rulesetVersion: row.rulesetVersion,
      },
      players: players.map(({ userId, seat }) => ({ userId, seat })),
      readyUserIds: players.filter((p) => p.readyAt !== null).map((p) => p.userId),
    });
  }
  async function transaction<T>(operation: (db: Client) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let fault: PrivateRoomMatchFault | undefined;
      try {
        return await scope.transaction(async (db) => {
          try {
            return await operation(db);
          } catch (error) {
            if (error instanceof PrivateRoomMatchFault) fault = error;
            throw error;
          }
        }, "Serializable");
      } catch (error) {
        if (fault) throw fault;
        if (
          !(error instanceof DatabaseError) ||
          !["DATABASE_TRANSACTION_CONFLICT", "DATABASE_UNIQUE_CONFLICT"].includes(error.code) ||
          attempt >= 4
        )
          throw error;
        // Independent Room creations can share SSI predicate pages; do not retry the same burst in lockstep.
        const backoffMs = 10 * 2 ** attempt;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, backoffMs + randomInt(backoffMs + 1)),
        );
      }
    }
  }
  return {
    read: (roomId) => scope.execute((db) => read(db, roomId)),
    roomForMatch: (matchId) =>
      scope.execute(async (db) => {
        const row = await db.match.findUnique({
          where: { id: matchId },
          select: { roomId: true, matchType: true, roomStartVersion: true },
        });
        return row?.matchType === "PRIVATE_ROOM" && row.roomStartVersion !== null
          ? row.roomId
          : null;
      }),
    create: (snapshot, descriptor, correlation) =>
      transaction(async (db) => {
        const existing = await read(db, snapshot.roomId);
        if (existing) return existing;
        const at = options.clock.nowMs();
        if (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000)
          throw new PrivateRoomMatchFault("INTERNAL_ERROR");
        const matchId = randomUUID();
        await db.match.create({
          data: {
            id: matchId,
            roomId: snapshot.roomId,
            roomStartVersion: snapshot.startVersion,
            gameId: snapshot.gameId,
            matchType: "PRIVATE_ROOM",
            status: "CREATED",
            engineVersion: descriptor.engineVersion,
            stateSchemaVersion: descriptor.stateSchemaVersion,
            rulesetVersion: descriptor.rulesetVersion,
            createdAt: new Date(at),
          },
        });
        for (const player of snapshot.players)
          await db.matchPlayer.create({
            data: {
              matchId,
              userId: player.userId,
              seat: player.seat,
              agentType: "HUMAN",
              connectionStatus: "DISCONNECTED",
              joinedAt: new Date(at),
            },
          });
        // Durable creation wake-up; no roster, invite, credential or game state.
        await db.outboxEvent.create({
          data: {
            id: randomUUID(),
            aggregateId: matchId,
            type: "MATCH_CHANGED_V1",
            schemaVersion: 1,
            payloadJsonb: {
              schemaVersion: 1,
              matchId,
              stateVersion: 0,
              lastEventSeq: 0,
              status: "CREATED",
            },
            status: "PENDING",
            requestId: correlation.requestId ?? null,
            traceparent: correlation.traceparent ?? null,
            nextAttemptAt: new Date(at),
            createdAt: new Date(at),
          },
        });
        return (await read(db, snapshot.roomId))!;
      }),
  };
}

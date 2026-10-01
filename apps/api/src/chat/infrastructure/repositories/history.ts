import { randomUUID } from "node:crypto";
import { DatabaseError, type createDatabase } from "@hambazi/database";
import type { ChatRepository } from "../../application/service.js";
import { chatMessageSchema } from "../../application/contracts.js";
export function createChatRepository(
  database: ReturnType<typeof createDatabase>,
  clock: { nowMs(): number },
): ChatRepository {
  const scope = database.forModule("chat");
  async function retry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await work();
      } catch (error) {
        if (
          attempt >= 4 ||
          !(error instanceof DatabaseError) ||
          !["DATABASE_TRANSACTION_CONFLICT", "DATABASE_UNIQUE_CONFLICT"].includes(error.code)
        )
          throw error;
      }
    }
  }
  function project(row: {
    id: string;
    matchId: string;
    userId: string;
    text: string;
    seq: number | null;
    createdAt: Date;
  }) {
    return chatMessageSchema.parse({
      schemaVersion: 1,
      messageId: row.id,
      matchId: row.matchId,
      userId: row.userId,
      text: row.text,
      seq: row.seq,
      createdAt: row.createdAt.getTime(),
    });
  }
  return {
    send(userId, input, correlation) {
      return retry(() =>
        scope.transaction(async (db) => {
          const existing = await db.chatMessage.findUnique({
            where: {
              matchId_userId_commandId: {
                matchId: input.matchId,
                userId,
                commandId: input.commandId,
              },
            },
          });
          if (existing) return existing.text === input.text ? project(existing) : "CONFLICT";
          const at = clock.nowMs();
          if (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000)
            throw new Error("Invalid chat clock");
          await db.chatStream.createMany({
            data: { matchId: input.matchId, lastSeq: 0 },
            skipDuplicates: true,
          });
          const stream = await db.chatStream.update({
            where: { matchId: input.matchId },
            data: { lastSeq: { increment: 1 } },
          });
          const id = randomUUID();
          const row = await db.chatMessage.create({
            data: {
              id,
              schemaVersion: 1,
              matchId: input.matchId,
              userId,
              commandId: input.commandId,
              seq: stream.lastSeq,
              text: input.text,
              createdAt: new Date(at),
            },
          });
          await db.outboxEvent.create({
            data: {
              id: randomUUID(),
              schemaVersion: 1,
              aggregateId: input.matchId,
              requestId: correlation.requestId ?? null,
              traceparent: correlation.traceparent ?? null,
              type: "CHAT_MESSAGE_V1",
              status: "PENDING",
              payloadJsonb: {
                schemaVersion: 1,
                matchId: input.matchId,
                messageId: id,
                seq: stream.lastSeq,
              },
              createdAt: new Date(at),
              nextAttemptAt: new Date(at),
            },
          });
          return project(row);
        }, "Serializable"),
      );
    },
    list(input) {
      return retry(() =>
        scope.transaction(async (db) => {
          const stream = await db.chatStream.findUnique({ where: { matchId: input.matchId } });
          const lastSeq = stream?.lastSeq ?? 0;
          const rows = await db.chatMessage.findMany({
            where: {
              matchId: input.matchId,
              schemaVersion: 1,
              seq: {
                not: null,
                gt: input.afterSeq ?? 0,
                lte: Math.min(lastSeq, (input.beforeSeq ?? 2147483648) - 1),
              },
            },
            orderBy: { seq: input.afterSeq === undefined ? "desc" : "asc" },
            take: (input.limit ?? 50) + 1,
          });
          const messages = rows.slice(0, input.limit ?? 50).map(project);
          if (input.afterSeq === undefined) messages.reverse();
          return { messages, lastSeq, hasMore: rows.length > (input.limit ?? 50) };
        }, "Serializable"),
      );
    },
    message(input) {
      return scope.execute(async (db) => {
        const row = await db.chatMessage.findFirst({
          where: { id: input.messageId, matchId: input.matchId, schemaVersion: 1, seq: input.seq },
        });
        return row ? project(row) : null;
      });
    },
  };
}

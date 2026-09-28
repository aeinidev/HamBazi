import { hash, randomUUID } from "node:crypto";
import { DatabaseError, type createDatabase } from "@hambazi/database";
import {
  AdmissionFault,
  type AdmissionRepository,
  type AdmissionTicket,
} from "../../application/admission.js";

export function createAdmissionRepository(
  database: ReturnType<typeof createDatabase>,
  options: {
    clock: { nowMs(): number };
    ticketTtlSeconds: number;
    reservationTtlSeconds: number;
  },
): AdmissionRepository {
  for (const ttl of [options.ticketTtlSeconds, options.reservationTtlSeconds])
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 2147483)
      throw new Error("Invalid admission lifetime");
  const scope = database.forModule("matches");
  type Client = Parameters<Parameters<typeof scope.transaction>[0]>[0];
  type Row = NonNullable<Awaited<ReturnType<Client["matchAdmission"]["findUnique"]>>>;
  const conflict = () => new AdmissionFault("MATCHMAKING_CONFLICT");
  function now() {
    const at = options.clock.nowMs();
    if (!Number.isSafeInteger(at) || at < 0 || at > 8640000000000000 - 2147483000)
      throw new Error("Invalid admission clock");
    return at;
  }
  async function transaction<T>(operation: (db: Client) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let fault: AdmissionFault | undefined;
      try {
        return await scope.transaction(async (db) => {
          try {
            return await operation(db);
          } catch (error) {
            if (error instanceof AdmissionFault) fault = error;
            // Always throw: a failed group operation must roll back every prior write.
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
      }
    }
  }
  function project(row: Row): AdmissionTicket {
    if (
      row.schemaVersion !== 1 ||
      !["SEARCHING", "RESERVED", "MATCHED", "CANCELLED", "EXPIRED"].includes(row.status)
    )
      throw new Error("Unsupported admission state");
    return {
      schemaVersion: 1,
      ticketId: row.id,
      actorUserId: row.actorUserId,
      commandId: row.commandId,
      gameId: row.gameId,
      mode: row.mode,
      capacity: row.capacity,
      status: row.status as AdmissionTicket["status"],
      generation: row.generation,
      expiresAt: row.expiresAt.getTime(),
      reservationId: row.reservationId,
      reservationUntil: row.reservationUntil?.getTime() ?? null,
      matchId: row.matchId,
    };
  }
  async function expire(db: Client, row: Row): Promise<Row> {
    if (["SEARCHING", "RESERVED"].includes(row.status) && row.expiresAt.getTime() <= now()) {
      return db.matchAdmission.update({
        where: { id: row.id },
        data: {
          status: "EXPIRED",
          activeKey: null,
          generation: { increment: 1 },
        },
      });
    }
    return row;
  }
  async function owned(db: Client, actor: string, id: string) {
    const row = await db.matchAdmission.findUnique({ where: { id } });
    if (!row || row.actorUserId !== actor) throw new AdmissionFault("NOT_FOUND");
    return expire(db, row);
  }
  async function reservation(db: Client, id: string) {
    const row = await db.matchReservation.findUnique({ where: { id } });
    if (!row) throw new AdmissionFault("NOT_FOUND");
    if (row.schemaVersion !== 1) throw new Error("Unsupported reservation schema");
    return row;
  }
  const tickets = (db: Client, id: string) =>
    db.matchAdmission.findMany({ where: { reservationId: id }, orderBy: { id: "asc" } });
  async function receipt(
    db: Client,
    actor: string,
    input: Parameters<AdmissionRepository["register"]>[1],
  ) {
    const previous = await db.matchAdmission.findUnique({
      where: { actorUserId_commandId: { actorUserId: actor, commandId: input.commandId } },
    });
    if (previous) {
      if (
        previous.gameId !== input.gameId ||
        previous.mode !== input.mode ||
        previous.capacity !== input.capacity
      )
        throw conflict();
      return project(await expire(db, previous));
    }
    return null;
  }
  return {
    receipt: (actor, input) => transaction((db) => receipt(db, actor, input)),
    register: (actor, input) =>
      transaction(async (db) => {
        const previous = await receipt(db, actor, input);
        if (previous) return previous;
        const activeKey = `${actor}:${input.gameId}:${input.mode}`;
        const active = await db.matchAdmission.findUnique({ where: { activeKey } });
        if (active && (await expire(db, active)).activeKey !== null) throw conflict();
        const at = now();
        return project(
          await db.matchAdmission.create({
            data: {
              id: randomUUID(),
              actorUserId: actor,
              commandId: input.commandId,
              gameId: input.gameId,
              mode: input.mode,
              capacity: input.capacity,
              status: "SEARCHING",
              activeKey,
              createdAt: new Date(at),
              expiresAt: new Date(at + options.ticketTtlSeconds * 1000),
            },
          }),
        );
      }),
    read: (actor, id) => transaction(async (db) => project(await owned(db, actor, id))),
    cancel: (actor, id) =>
      transaction(async (db) => {
        const row = await owned(db, actor, id);
        if (!["SEARCHING", "RESERVED"].includes(row.status)) return project(row);
        return project(
          await db.matchAdmission.update({
            where: { id },
            data: {
              status: "CANCELLED",
              activeKey: null,
              generation: { increment: 1 },
            },
          }),
        );
      }),
    authorize: (actor, id) =>
      transaction(async (db) => {
        const ticket = await owned(db, actor, id);
        if (ticket.status !== "MATCHED" || !ticket.matchId) throw new AdmissionFault("NOT_FOUND");
        const match = await db.match.findUnique({ where: { id: ticket.matchId } });
        const player = await db.matchPlayer.findFirst({
          where: { matchId: ticket.matchId, userId: actor },
        });
        if (
          !match ||
          !["CREATED", "WAITING_FOR_PLAYERS", "READY", "STARTING", "ACTIVE"].includes(
            match.status,
          ) ||
          !player ||
          player.agentType !== "HUMAN" ||
          player.connectionStatus === "REPLACED_BY_BOT"
        )
          throw new AdmissionFault("NOT_FOUND");
        return { matchId: ticket.matchId };
      }),
    reserve: (input) =>
      transaction(async (db) => {
        const refs = [...input.tickets].sort((a, b) => a.ticketId.localeCompare(b.ticketId));
        const digest = hash(
          "sha256",
          JSON.stringify([1, refs.map((r) => [r.ticketId, r.generation])]),
          "hex",
        );
        const previous = await db.matchReservation.findUnique({
          where: { id: input.reservationId },
        });
        const at = now();
        if (previous) {
          if (
            previous.requestDigest !== digest ||
            previous.releasedAt ||
            previous.expiresAt.getTime() <= at ||
            previous.matchId
          )
            throw conflict();
          const rows = await tickets(db, input.reservationId);
          if (
            rows.length !== refs.length ||
            rows.some(
              (r, i) =>
                r.id !== refs[i]!.ticketId ||
                r.generation !== refs[i]!.generation + 1 ||
                r.status !== "RESERVED",
            )
          )
            throw conflict();
          return rows.map(project);
        }
        const rows: Row[] = [];
        for (const ref of refs) {
          const row = await db.matchAdmission.findUnique({ where: { id: ref.ticketId } });
          if (
            !row ||
            row.generation !== ref.generation ||
            row.expiresAt.getTime() <= at ||
            !(
              row.status === "SEARCHING" ||
              (row.status === "RESERVED" && row.reservationUntil!.getTime() <= at)
            )
          )
            throw conflict();
          rows.push(row);
        }
        const first = rows[0]!;
        if (
          rows.length !== first.capacity ||
          rows.some(
            (r) =>
              r.gameId !== first.gameId || r.mode !== first.mode || r.capacity !== first.capacity,
          ) ||
          new Set(rows.map((r) => r.actorUserId)).size !== rows.length
        )
          throw conflict();
        const until = new Date(
          Math.min(
            at + options.reservationTtlSeconds * 1000,
            ...rows.map((r) => r.expiresAt.getTime()),
          ),
        );
        await db.matchReservation.create({
          data: { id: input.reservationId, requestDigest: digest, expiresAt: until },
        });
        const result: AdmissionTicket[] = [];
        for (const row of rows)
          result.push(
            project(
              await db.matchAdmission.update({
                where: { id: row.id },
                data: {
                  status: "RESERVED",
                  generation: { increment: 1 },
                  reservationId: input.reservationId,
                  reservationUntil: until,
                },
              }),
            ),
          );
        return result;
      }),
    release: (id) =>
      transaction(async (db) => {
        const res = await reservation(db, id);
        if (res.matchId || res.releasedAt) return { matchId: res.matchId };
        const rows = await tickets(db, id);
        for (const row of rows) {
          if (row.status !== "RESERVED") continue;
          const overdue = row.expiresAt.getTime() <= now();
          await db.matchAdmission.update({
            where: { id: row.id },
            data: {
              status: overdue ? "EXPIRED" : "SEARCHING",
              activeKey: overdue ? null : row.activeKey,
              generation: { increment: 1 },
              reservationId: null,
              reservationUntil: null,
            },
          });
        }
        await db.matchReservation.update({ where: { id }, data: { releasedAt: new Date(now()) } });
        return { matchId: null };
      }),
    inspect: (id) =>
      transaction(async (db) => {
        const res = await reservation(db, id);
        return { matchId: res.matchId, tickets: (await tickets(db, id)).map(project) };
      }),
    commit: (id, descriptor, correlation) =>
      transaction(async (db) => {
        const res = await reservation(db, id);
        if (res.matchId) return { matchId: res.matchId };
        const at = now();
        if (res.releasedAt || res.expiresAt.getTime() <= at) throw conflict();
        const rows = await tickets(db, id);
        const first = rows[0];
        if (
          !first ||
          rows.length !== first.capacity ||
          rows.some(
            (r) =>
              r.status !== "RESERVED" ||
              r.expiresAt.getTime() <= at ||
              r.reservationUntil!.getTime() <= at,
          )
        )
          throw conflict();
        const matchId = randomUUID();
        await db.match.create({
          data: {
            id: matchId,
            gameId: first.gameId,
            matchType: "MATCHMAKING",
            status: "CREATED",
            engineVersion: descriptor.engineVersion,
            stateSchemaVersion: descriptor.stateSchemaVersion,
            rulesetVersion: descriptor.rulesetVersion,
            createdAt: new Date(at),
          },
        });
        for (const [seat, row] of rows.entries()) {
          await db.matchPlayer.create({
            data: {
              matchId,
              userId: row.actorUserId,
              seat,
              agentType: "HUMAN",
              connectionStatus: "DISCONNECTED",
            },
          });
          await db.matchAdmission.update({
            where: { id: row.id },
            data: { status: "MATCHED", activeKey: null, matchId, generation: { increment: 1 } },
          });
        }
        await db.matchReservation.update({ where: { id }, data: { matchId } });
        await db.outboxEvent.create({
          data: {
            id: randomUUID(),
            aggregateId: matchId,
            type: "matchmaking.found",
            schemaVersion: 1,
            requestId: correlation?.requestId ?? null,
            traceparent: correlation?.traceparent ?? null,
            payloadJsonb: { schemaVersion: 1, matchId, reservationId: id },
            status: "PENDING",
            createdAt: new Date(at),
            nextAttemptAt: new Date(at),
          },
        });
        return { matchId };
      }),
  };
}

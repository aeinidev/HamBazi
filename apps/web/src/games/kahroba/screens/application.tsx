import { useEffect, useState, type ReactNode } from "react";
import { useQuery, QueryClientProvider } from "@tanstack/react-query";
import { z } from "zod";
import {
  RuntimeContext,
  useRuntime,
  useSession,
  useTask,
  ErrorNotice,
  go,
} from "../../../ui/shared.js";
import type { Runtime } from "../../../platform/runtime.js";
import { ClientError } from "../../../platform/errors.js";
import {
  roomAckSchema,
  roomResponseSchema,
  previewSchema,
  matchAckSchema,
  okValue,
} from "../../../platform/contracts.js";
import { createKahrobaRealtime, kahrobaInviteSchema as inviteSchema } from "../runtime.js";
import { publicKahrobaSnapshot } from "../adapters/index.js";
import { KahrobaSession } from "./match.js";
const capabilities = z.strictObject({
  schemaVersion: z.literal(1),
  gameId: z.literal("kahroba"),
  registered: z.boolean(),
  enabled: z.boolean(),
  admission: z.boolean(),
  minPlayers: z.literal(2),
  maxPlayers: z.union([z.literal(2), z.literal(4)]),
  engineVersion: z.literal("kahroba-v1"),
  stateSchemaVersion: z.literal(1),
  rulesetVersion: z.literal("kahroba-base-v1"),
  viewSchemaVersion: z.literal(1),
  turnDurationMs: z.null(),
  timeoutPolicyVersion: z.null(),
});
const namesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  players: z
    .array(z.strictObject({ userId: z.uuid(), displayName: z.string().min(1).max(256) }))
    .max(4),
});
const validId = (id: string | undefined) => (id && z.uuid().safeParse(id).success ? id : null);
function RoutedTable({ id }: { id: string }) {
  const r = useRuntime(),
    snapshot = useSession((s) => s.snapshot);
  const names = useQuery({
    queryKey: ["kahroba-names", id, snapshot?.status],
    queryFn: ({ signal }) =>
      r.http(`/v1/kahroba/matches/${id}/players`, namesSchema, undefined, "GET", true, signal),
    enabled: snapshot?.matchId === id,
  });
  return (
    <KahrobaSession
      id={id}
      names={Object.fromEntries((names.data?.players ?? []).map((p) => [p.userId, p.displayName]))}
      onBack={() => go("/restricted/kahroba")}
    />
  );
}
function PrivateRoom({ id }: { id: string }) {
  const r = useRuntime(),
    userId = useSession((s) => s.session?.userId),
    connection = useSession((s) => s.connection),
    snapshot = useSession((s) => s.snapshot),
    task = useTask("fa"),
    [invite, setInvite] = useState("");
  const room = useQuery({
    queryKey: ["kahroba-room", id],
    queryFn: ({ signal }) =>
      r.http(`/v1/kahroba/rooms/${id}`, roomResponseSchema, undefined, "GET", true, signal),
    refetchInterval: 10000,
  });
  const matchId = room.data?.room.startedMatchId;
  useEffect(() => {
    if (connection === "connected" && matchId)
      void r
        .realtime()
        .subscribe(matchId)
        .catch((error: unknown) =>
          r.store.setState({
            realtimeError: error instanceof ClientError ? error : new ClientError("INTERNAL_ERROR"),
          }),
        );
  }, [r, connection, matchId]);
  useEffect(() => {
    if (
      matchId &&
      snapshot?.matchId === matchId &&
      ["ACTIVE", "FINISHED"].includes(snapshot.status)
    )
      go(`/restricted/kahroba/match/${matchId}`);
  }, [matchId, snapshot?.matchId, snapshot?.status]);
  if (room.isPending) return <p role="status">در حال دریافت اتاق…</p>;
  if (room.error)
    return <ErrorNotice error={room.error} language="fa" retry={() => void room.refetch()} />;
  const value = room.data.room,
    waiting = ["WAITING", "FULL"].includes(value.status),
    host = value.hostUserId === userId;
  return (
    <section className="kh-game" dir="rtl">
      <h1>اتاق خصوصی کهربا</h1>
      <p>
        {value.members.length} / {value.capacity} بازیکن
      </p>
      <ol>
        {value.members.map((m) => (
          <li key={m.userId}>
            {m.userId === userId ? "شما" : `بازیکن ${m.seat + 1}`}
            {m.userId === value.hostUserId ? " · میزبان" : ""}
          </li>
        ))}
      </ol>
      {host && waiting && (
        <button
          onClick={() =>
            task.run(async () => {
              const response = await r.http(`/v1/kahroba/rooms/${id}/invite`, inviteSchema);
              setInvite(response.invite.startParam);
            })
          }
        >
          دریافت دعوت
        </button>
      )}
      {invite && (
        <label>
          کد دعوت
          <input
            aria-label="کد دعوت"
            dir="ltr"
            value={invite}
            readOnly
            onFocus={(e) => e.target.select()}
          />
        </label>
      )}
      {host && waiting && (
        <button
          disabled={task.blocked || connection !== "connected" || value.status !== "FULL"}
          onClick={() => {
            const input = {
              schemaVersion: 1,
              commandId: crypto.randomUUID(),
              roomId: id,
              expectedVersion: value.version,
            };
            task.run(async () => {
              await r.realtime().request("room:start", input, roomAckSchema);
              await room.refetch();
            });
          }}
        >
          شروع بازی
        </button>
      )}
      {matchId && snapshot?.matchId === matchId && snapshot.status === "WAITING_FOR_PLAYERS" && (
        <button
          disabled={task.blocked || connection !== "connected"}
          onClick={() => {
            const input = {
              schemaVersion: 1,
              actionId: crypto.randomUUID(),
              matchId,
              expectedVersion: snapshot.stateVersion,
            };
            task.run(async () => {
              await r.realtime().request("match:ready", input, okValue(matchAckSchema));
              await r.realtime().sync();
            });
          }}
        >
          آماده‌ام
        </button>
      )}
      {task.notice}
      <button onClick={() => void room.refetch()}>به‌روز کردن اتاق</button>
      <button onClick={() => go("/restricted/kahroba")}>بازگشت</button>
    </section>
  );
}
function PrivateLobby() {
  const r = useRuntime(),
    task = useTask("fa"),
    connection = useSession((s) => s.connection),
    [capacity, setCapacity] = useState(2),
    [invite, setInvite] = useState("");
  const cap = useQuery({
    queryKey: ["kahroba-capabilities"],
    queryFn: ({ signal }) =>
      r.http("/v1/kahroba/capabilities", capabilities, undefined, "GET", true, signal),
  });
  if (cap.isPending) return <p role="status">در حال دریافت کهربا…</p>;
  if (cap.error)
    return <ErrorNotice error={cap.error} language="fa" retry={() => void cap.refetch()} />;
  return (
    <section className="kh-game" dir="rtl">
      <h1>کهربا</h1>
      <p>میز خصوصی</p>
      <label>
        تعداد بازیکنان
        <select
          aria-label="تعداد بازیکنان"
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value))}
        >
          {Array.from({ length: cap.data.maxPlayers - 1 }, (_, i) => (
            <option key={i + 2} value={i + 2}>
              {i + 2}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={task.blocked || !cap.data.admission || connection !== "connected"}
        onClick={() => {
          const input = {
            schemaVersion: 1,
            commandId: crypto.randomUUID(),
            gameId: "kahroba",
            capacity,
          };
          task.run(async () => {
            const result = await r.http("/v1/kahroba/rooms", roomAckSchema, input);
            go(`/restricted/kahroba/room/${result.roomId}`);
          });
        }}
      >
        ساخت اتاق خصوصی
      </button>
      <label>
        دعوت میزبان
        <input
          aria-label="دعوت میزبان"
          value={invite}
          dir="ltr"
          onChange={(e) => setInvite(e.target.value)}
        />
      </label>
      <button
        disabled={
          task.blocked ||
          !cap.data.admission ||
          connection !== "connected" ||
          !/^room_[A-Za-z0-9_-]{43}$/.test(invite)
        }
        onClick={() => {
          const code = invite,
            commandId = crypto.randomUUID();
          let input:
            | {
                schemaVersion: number;
                commandId: string;
                roomId: string;
                expectedVersion: number;
                inviteCode: string;
              }
            | undefined;
          task.run(async () => {
            if (!input) {
              const preview = await r.http("/v1/kahroba/room-invites/resolve", previewSchema, {
                schemaVersion: 1,
                startParam: code,
              });
              input = {
                schemaVersion: 1,
                commandId,
                roomId: preview.room.id,
                expectedVersion: preview.room.version,
                inviteCode: code.slice(5),
              };
            }
            await r.realtime().request("room:join", input, roomAckSchema);
            go(`/restricted/kahroba/room/${input.roomId}`);
          });
        }}
      >
        پیوستن به اتاق
      </button>
      {task.notice}
      <button onClick={() => go("/games")}>خانه</button>
    </section>
  );
}
function PrivateApplication() {
  const [route, setRoute] = useState(location.hash.slice(1));
  useEffect(() => {
    const change = () => setRoute(location.hash.slice(1));
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const parts = route.split("/"),
    id = validId(parts[4]);
  return (
    <main className="kh-app" dir="rtl">
      {parts[3] === "match" && id ? (
        <RoutedTable id={id} />
      ) : parts[3] === "room" && id ? (
        <PrivateRoom id={id} />
      ) : (
        <PrivateLobby />
      )}
    </main>
  );
}
function TransportSession({ parent }: { parent: Runtime }) {
  const session = useSession((s) => s.session);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  useEffect(() => {
    const child = parent.forkGame(createKahrobaRealtime, publicKahrobaSnapshot);
    setRuntime(child);
    return () => child.dispose();
  }, [parent, session?.sessionId]);
  if (!runtime) return <p role="status">در حال اتصال و همگام‌سازی…</p>;
  return (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.query}>
        <PrivateApplication />
      </QueryClientProvider>
    </RuntimeContext.Provider>
  );
}
/** Client routing is an affordance; real authentication/admission remain owned by the private API. */
export function KahrobaRouteBoundary({
  runtime,
  children,
}: {
  runtime: Runtime;
  children: ReactNode;
}) {
  const session = useSession((s) => s.session),
    [route, setRoute] = useState(location.hash.slice(1));
  useEffect(() => {
    const change = () => setRoute(location.hash.slice(1));
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const cap = useQuery({
    queryKey: ["kahroba-private-entry"],
    queryFn: ({ signal }) =>
      runtime.http("/v1/kahroba/capabilities", capabilities, undefined, "GET", true, signal),
    enabled: !!session,
  });
  if (session && route.startsWith("/restricted/kahroba") && cap.data?.enabled)
    return <TransportSession key={session.sessionId} parent={runtime} />;
  return (
    <>
      {children}
      {session && cap.data?.enabled && (
        <a className="kh-private-entry" href="#/restricted/kahroba">
          میز خصوصی کهربا
        </a>
      )}
    </>
  );
}

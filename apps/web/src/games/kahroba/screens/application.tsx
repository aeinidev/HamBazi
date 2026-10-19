import { useEffect, useState, type ReactNode } from "react";
import { useQuery, QueryClientProvider } from "@tanstack/react-query";
import { z } from "zod";
import { RuntimeContext, useRuntime, useSession, go } from "../../../ui/shared.js";
import type { Runtime } from "../../../platform/runtime.js";
import { ClientError } from "../../../platform/errors.js";
import { roomResponseSchema } from "../../../platform/contracts.js";
import { createKahrobaRealtime } from "../runtime.js";
import { KahrobaLobby } from "./lobby.js";
import { kahrobaLaunch } from "../launch.js";
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
    connection = useSession((s) => s.connection),
    snapshot = useSession((s) => s.snapshot);
  const room = useQuery({
    queryKey: ["kahroba-room", id],
    queryFn: ({ signal }) =>
      r.http(`/v1/kahroba/rooms/${id}`, roomResponseSchema, undefined, "GET", true, signal),
    refetchInterval: 1500,
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
  return <KahrobaLobby roomId={id} />;
}
function PrivateApplication({ startParam }: { startParam?: string | undefined }) {
  const launch = kahrobaLaunch(startParam);
  useEffect(() => {
    if (launch && !location.hash.slice(1).startsWith("/restricted/kahroba"))
      go(
        `/restricted/kahroba${launch.kind === "testing" && launch.roomId ? `/room/${launch.roomId}` : launch.kind === "invite" ? "/invite" : ""}`,
      );
  }, [startParam]);
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
      {parts[3] === "testing" ? (
        parts[4] === "room" && validId(parts[5]) ? (
          <PrivateRoom id={validId(parts[5])!} />
        ) : (
          <KahrobaLobby startParam={launch?.kind === "invite" ? launch.startParam : undefined} />
        )
      ) : parts[3] === "match" && id ? (
        <RoutedTable id={id} />
      ) : parts[3] === "room" && id ? (
        <PrivateRoom id={id} />
      ) : (
        <KahrobaLobby
          startParam={
            route.endsWith("/invite") && launch?.kind === "invite" ? launch.startParam : undefined
          }
        />
      )}
    </main>
  );
}
function TransportSession({
  parent,
  startParam,
}: {
  parent: Runtime;
  startParam?: string | undefined;
}) {
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
        <PrivateApplication startParam={startParam} />
      </QueryClientProvider>
    </RuntimeContext.Provider>
  );
}
/** Client routing is an affordance; real authentication/admission remain owned by the private API. */
export function KahrobaRouteBoundary({
  runtime,
  children,
  startParam,
}: {
  runtime: Runtime;
  children: ReactNode;
  startParam?: string | undefined;
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
  if (
    session &&
    cap.data?.enabled &&
    (route.startsWith("/restricted/kahroba") || kahrobaLaunch(startParam))
  )
    return <TransportSession key={session.sessionId} parent={runtime} startParam={startParam} />;
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

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useRuntime, useSession, useTask, go } from "../../../ui/shared.js";
import { AccountAvatar, MidnightIcon } from "../../../ui/midnight.js";
import {
  ticketSchema,
  okValue,
  foundSchema,
  matchReferenceSchema,
  matchAckSchema,
  profileSchema,
} from "../../../platform/contracts.js";
import { ClientError, errorMessage } from "../../../platform/errors.js";
import { PalaceGem } from "../components/palace-gem.js";
import { usePalacePreferences } from "../palace-preferences.js";
import { currentKahrobaSearchSchema } from "../public-lobby.js";
import "../components/lobby.css";
import { useFittedPageScroll } from "../../../ui/fitted-page-scroll.js";

const lobbySchema = z.strictObject({
  schemaVersion: z.literal(1),
  matchId: z.uuid(),
  gameId: z.literal("kahroba"),
  stateVersion: z.number().int().nonnegative(),
  status: z.enum([
    "CREATED",
    "WAITING_FOR_PLAYERS",
    "READY",
    "STARTING",
    "ACTIVE",
    "FINISHED",
    "TERMINATED",
  ]),
  hostUserId: z.uuid(),
  players: z
    .array(
      z.strictObject({
        userId: z.uuid(),
        seat: z.number().int().nonnegative(),
        ready: z.boolean(),
      }),
    )
    .min(2)
    .max(4),
});
const digits = (n: number) => new Intl.NumberFormat("fa-IR").format(n);
export function KahrobaSearch({ initialCapacity = 2 }: { initialCapacity?: number }) {
  const pageRef = useFittedPageScroll<HTMLElement>();
  const { preferences, sound } = usePalacePreferences();
  const runtime = useRuntime(),
    task = useTask("fa"),
    session = useSession((s) => s.session),
    ticket = useSession((s) => s.ticket),
    online = useSession((s) => s.connection === "connected");
  const joining = useRef<string | null>(null);
  const current = useQuery({
    queryKey: ["kahroba-current-search", session?.sessionId],
    queryFn: ({ signal }) =>
      runtime.http(
        "/v1/kahroba/matchmaking/current",
        okValue(currentKahrobaSearchSchema.nullable()),
        undefined,
        "GET",
        true,
        signal,
      ),
    enabled: !!session && !ticket,
  });
  useEffect(() => {
    if (current.data?.value && !runtime.store.getState().ticket)
      runtime.store.setState({ ticket: current.data.value });
  }, [runtime, current.data]);
  const active = !!ticket && !["EXPIRED", "CANCELLED"].includes(ticket.status);
  const status = useQuery({
    queryKey: ["kahroba-ticket", session?.sessionId, ticket?.ticketId],
    queryFn: () =>
      runtime
        .realtime()
        .request(
          "matchmaking:status",
          { schemaVersion: 1, ticketId: ticket!.ticketId },
          okValue(ticketSchema),
        ),
    enabled: online && active && ticket?.status !== "MATCHED",
    refetchInterval: 2000,
  });
  useEffect(() => {
    const previous = runtime.store.getState().ticket;
    if (
      status.data &&
      previous?.ticketId === status.data.value.ticketId &&
      !["MATCHED", "CANCELLED", "EXPIRED"].includes(previous.status)
    )
      runtime.store.setState({ ticket: status.data.value });
  }, [runtime, status.data]);
  function cancel() {
    if (!online || !session || !ticket || task.blocked) return;
    const identity = session.sessionId,
      payload = { schemaVersion: 1, ticketId: ticket.ticketId };
    task.run(async () => {
      const result = await runtime
        .realtime()
        .request("matchmaking:cancel", payload, okValue(ticketSchema));
      if (runtime.store.getState().session?.sessionId !== identity) return;
      runtime.store.setState({ ticket: result.value });
      if (["CANCELLED", "EXPIRED"].includes(result.value.status)) {
        runtime.query.removeQueries({ queryKey: ["kahroba-current-search"] });
        go("/restricted/kahroba");
      }
    });
  }
  function join() {
    if (!online || !session || !ticket || task.blocked) return;
    const identity = session.sessionId,
      payload = { schemaVersion: 1, ticketId: ticket.ticketId };
    task.run(async () => {
      try {
        const found = await runtime
          .realtime()
          .request("matchmaking:found", payload, okValue(foundSchema));
        const admitted = await runtime
          .realtime()
          .request(
            "matchmaking:admit",
            { ...payload, admissionToken: found.value.admissionToken },
            okValue(matchReferenceSchema),
          );
        if (runtime.store.getState().session?.sessionId === identity)
          go(`/restricted/kahroba/public/${admitted.value.matchId}`);
      } catch (error) {
        if (!(error instanceof ClientError) || error.code !== "NOT_FOUND") throw error;
        // A host may cancel before a disconnected member admits. Reconcile the
        // durable membership instead of leaving that member on a frozen search.
        const recovered = await runtime.http(
          "/v1/kahroba/matchmaking/current",
          okValue(currentKahrobaSearchSchema.nullable()),
          undefined,
          "GET",
        );
        if (runtime.store.getState().session?.sessionId !== identity) return;
        runtime.store.setState({ ticket: recovered.value });
        runtime.query.removeQueries({ queryKey: ["kahroba-current-search"] });
        go(
          recovered.value?.matchId
            ? `/restricted/kahroba/public/${recovered.value.matchId}`
            : recovered.value
              ? `/restricted/kahroba/search/${recovered.value.capacity}`
              : "/restricted/kahroba",
        );
      }
    });
  }
  useEffect(() => {
    if (
      ticket?.status === "MATCHED" &&
      online &&
      !task.blocked &&
      joining.current !== ticket.ticketId
    ) {
      joining.current = ticket.ticketId;
      join();
    }
  });
  return (
    <section
      ref={pageRef}
      className={`khl-lobby khl-search ${!preferences.motion ? "khl-no-motion" : ""}`}
      onClickCapture={sound}
      dir="rtl"
    >
      <header className="khl-header">
        <button
          type="button"
          aria-label="بازگشت"
          disabled={(active && !task.error) || task.blocked}
          onClick={() => go("/restricted/kahroba")}
        >
          <MidnightIcon name="back" />
        </button>
      </header>
      <h1>جستجوی اتاق</h1>
      <p>{digits([2, 3, 4].includes(initialCapacity) ? initialCapacity : 2)} نفره</p>
      <p role="status">
        {ticket?.status === "MATCHED"
          ? "هم‌بازی‌های شما پیدا شدند"
          : active
            ? "در حال جستجوی بازیکنان مناسب…"
            : current.isPending
              ? "در حال بازیابی جستجو…"
              : "جستجو پایان یافته است"}
      </p>
      <div className="khl-orbit" aria-hidden="true">
        <i />
        <i />
        <PalaceGem />
      </div>
      <button
        type="button"
        className="khl-search-cancel"
        disabled={task.blocked || (active && !online) || ticket?.status === "MATCHED"}
        onClick={() => (active ? cancel() : go("/restricted/kahroba"))}
      >
        لغو جستجو
      </button>
      <p className="khl-message">
        جستجو شما را به بازیکنان واقعی در صف بازی با همین ظرفیت متصل می‌کند.
      </p>
      {!online && <p role="status">در انتظار اتصال به سرور…</p>}
      {status.error && <p role="alert">{errorMessage(status.error, "fa")}</p>}
      {task.notice}
      {current.error && <p role="alert">{errorMessage(current.error, "fa")}</p>}
    </section>
  );
}
export function KahrobaPublicLobby({ id }: { id: string }) {
  const pageRef = useFittedPageScroll<HTMLElement>();
  const runtime = useRuntime(),
    session = useSession((s) => s.session),
    online = useSession((s) => s.connection === "connected"),
    photoUrl = useSession((s) => s.photoUrl),
    task = useTask("fa");
  const lobby = useQuery({
    queryKey: ["kahroba-public-lobby", id, session?.sessionId],
    queryFn: ({ signal }) =>
      runtime.http(
        `/v1/kahroba/matches/${id}/lobby`,
        okValue(lobbySchema),
        undefined,
        "GET",
        true,
        signal,
      ),
    enabled: !!session,
    refetchInterval: 1500,
  });
  const names = useQuery({
    queryKey: ["kahroba-public-names", id],
    queryFn: ({ signal }) =>
      runtime.http(
        `/v1/kahroba/matches/${id}/players`,
        z.object({
          schemaVersion: z.literal(1),
          players: z.array(z.object({ userId: z.uuid(), displayName: z.string() })),
        }),
        undefined,
        "GET",
        true,
        signal,
      ),
    enabled: !!lobby.data,
  });
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: ({ signal }) => runtime.http("/v1/me", profileSchema, undefined, "GET", true, signal),
    enabled: !!session,
  });
  const value = lobby.data?.value;
  useEffect(() => {
    if (value && ["ACTIVE", "FINISHED"].includes(value.status)) {
      runtime.store.setState({ ticket: null });
      runtime.query.removeQueries({ queryKey: ["kahroba-current-search"] });
      go(`/restricted/kahroba/match/${id}`);
    }
  }, [runtime, value, id]);
  function act(kind: "ready" | "start" | "cancel") {
    if (!session || !value || !online || task.blocked) return;
    const identity = session.sessionId,
      payload = {
        schemaVersion: 1,
        actionId: crypto.randomUUID(),
        matchId: id,
        expectedVersion: value.stateVersion,
      };
    task.run(async () => {
      if (kind === "ready")
        await runtime.realtime().request("match:ready", payload, okValue(matchAckSchema));
      else await runtime.http(`/v1/kahroba/matches/${id}/${kind}`, okValue(lobbySchema), payload);
      if (runtime.store.getState().session?.sessionId === identity) await lobby.refetch();
    });
  }
  const selfReady = value?.players.some((p) => p.userId === session?.userId && p.ready),
    host = value?.hostUserId === session?.userId;
  return (
    <section ref={pageRef} className="khl-lobby" dir="rtl">
      <h1 className="khl-title">اتاق عمومی کهربا</h1>
      <p className="khl-message" role="status">
        پس از آمادگی همهٔ بازیکنان، میزبان بازی را شروع می‌کند.
      </p>
      <div className="khl-players">
        {value?.players.map((p) => (
          <article
            className={`khl-player ${p.userId === value.hostUserId ? "is-host" : ""}`}
            key={p.userId}
          >
            <div className="khl-avatar">
              {p.userId === session?.userId ? (
                <AccountAvatar photoUrl={photoUrl} />
              ) : (
                <MidnightIcon name="profile" />
              )}
            </div>
            <div className="khl-player-info">
              <strong dir="auto">
                {p.userId === session?.userId
                  ? profile.data?.displayName || "شما"
                  : names.data?.players.find((n) => n.userId === p.userId)?.displayName ||
                    `بازیکن ${digits(p.seat + 1)}`}
              </strong>
              {p.userId === value.hostUserId && <span className="khl-host-badge">میزبان</span>}
              <small>{p.ready ? "آماده است ✓" : "در حال آماده شدن"}</small>
            </div>
          </article>
        ))}
      </div>
      <button
        type="button"
        className="khl-ready"
        disabled={!online || task.blocked || selfReady || value?.status !== "WAITING_FOR_PLAYERS"}
        onClick={() => act("ready")}
      >
        {selfReady ? "آماده هستید ✓" : "آماده‌ام"}
      </button>
      <button
        type="button"
        className="khl-start"
        disabled={
          !online ||
          task.blocked ||
          !host ||
          !value?.players.every((p) => p.ready) ||
          !["WAITING_FOR_PLAYERS", "READY"].includes(value?.status ?? "")
        }
        onClick={() => act("start")}
      >
        <MidnightIcon name="play" />
        <span>
          <strong>شروع بازی</strong>
          <small>
            {value?.players.every((p) => p.ready)
              ? "همه برای رقابت آماده‌اند"
              : "در انتظار آمادگی همهٔ بازیکنان"}
          </small>
        </span>
      </button>
      {host && ["WAITING_FOR_PLAYERS", "READY"].includes(value?.status ?? "") && (
        <button
          type="button"
          className="khl-search-cancel khl-cancel-room"
          disabled={!online || task.blocked}
          onClick={() => act("cancel")}
        >
          لغو اتاق
        </button>
      )}
      {value?.status === "TERMINATED" && (
        <>
          <p role="status">میزبان اتاق را لغو کرد.</p>
          <button
            type="button"
            className="khl-search-cancel"
            onClick={() => {
              runtime.store.setState({ ticket: null });
              runtime.query.removeQueries({ queryKey: ["kahroba-current-search"] });
              go("/restricted/kahroba");
            }}
          >
            بازگشت
          </button>
        </>
      )}
      {lobby.error && <p role="alert">{errorMessage(lobby.error, "fa")}</p>}
      {task.notice}
    </section>
  );
}

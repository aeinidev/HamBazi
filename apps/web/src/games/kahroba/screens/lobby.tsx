import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import {
  roomSchema,
  profileSchema,
  roomResponseSchema,
  previewSchema,
  roomAckSchema,
  matchAckSchema,
  okValue,
} from "../../../platform/contracts.js";
import { ClientError, errorMessage } from "../../../platform/errors.js";
import { useRuntime, useSession, useTask, go } from "../../../ui/shared.js";
import { KahrobaLobbyView } from "../components/lobby.js";
import { parseRoomStartParam } from "@hambazi/contracts";
import { kahrobaInviteSchema } from "../runtime.js";
import {
  canShareKahrobaRoom,
  verifiedKahrobaInvite,
  verifyKahrobaInvitePreview,
  shareKahrobaInvite,
  type KahrobaLobbyInvite,
} from "../lobby-invitation.js";

const readinessSchema = z.strictObject({
  canStart: z.boolean(),
  schemaVersion: z.literal(1),
  roomId: z.uuid(),
  matchId: z.uuid().nullable(),
  stateVersion: z.number().int().nonnegative().nullable(),
  status: z
    .enum([
      "CREATED",
      "WAITING_FOR_PLAYERS",
      "READY",
      "STARTING",
      "ACTIVE",
      "FINISHED",
      "TERMINATED",
    ])
    .nullable(),
  players: z.array(z.strictObject({ userId: z.uuid(), ready: z.boolean() })).max(4),
});
export function KahrobaLobby({
  roomId,
  startParam,
}: {
  roomId?: string | undefined;
  startParam?: string | undefined;
}) {
  const runtime = useRuntime(),
    session = useSession((s) => s.session),
    task = useTask("fa"),
    connection = useSession((s) => s.connection),
    photoUrl = useSession((s) => s.photoUrl),
    flight = useRef<AbortController | null>(null),
    [pending, setPending] = useState(false),
    [invite, setInvite] = useState<KahrobaLobbyInvite | null>(null),
    [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null),
    [now, setNow] = useState(Date.now);
  const room = useQuery({
    queryKey: ["kahroba-room", roomId],
    queryFn: ({ signal }) =>
      runtime.http(
        `/v1/kahroba/rooms/${roomId}`,
        roomResponseSchema,
        undefined,
        "GET",
        true,
        signal,
      ),
    enabled: !!session && !!roomId,
    refetchInterval: 1500,
  });
  const current = useQuery({
    queryKey: ["kahroba-current-room"],
    queryFn: ({ signal }) =>
      runtime.http(
        "/v1/kahroba/current-room",
        z.strictObject({
          ok: z.literal(true),
          schemaVersion: z.literal(1),
          room: roomSchema.nullable(),
        }),
        undefined,
        "GET",
        true,
        signal,
      ),
    enabled: !!session && !roomId && !startParam,
  });
  useEffect(() => {
    if (
      session &&
      !roomId &&
      !startParam &&
      current.isSuccess &&
      !current.isFetching &&
      current.data.room?.gameId === "kahroba"
    )
      go(`/restricted/kahroba/room/${current.data.room.id}`);
  }, [session, roomId, startParam, current.data, current.isSuccess, current.isFetching]);
  const permissions = useQuery({
    queryKey: ["kahroba-lobby-permissions"],
    queryFn: ({ signal }) =>
      runtime.http(
        "/v1/kahroba/lobby-permissions",
        z.strictObject({ schemaVersion: z.literal(1), canCreate: z.boolean() }),
        undefined,
        "GET",
        true,
        signal,
      ),
    enabled: !!session,
  });
  const readiness = useQuery({
    queryKey: ["kahroba-readiness", roomId],
    queryFn: ({ signal }) =>
      runtime.http(
        `/v1/kahroba/rooms/${roomId}/readiness`,
        okValue(readinessSchema),
        undefined,
        "GET",
        true,
        signal,
      ),
    enabled: !!session && !!roomId && !!room.data,
    refetchInterval: 1500,
  });
  const preview = useQuery({
    queryKey: ["kahroba-invitation-preview", startParam],
    queryFn: ({ signal }) =>
      runtime.http(
        "/v1/kahroba/room-invites/resolve",
        previewSchema,
        { schemaVersion: 1, startParam },
        "POST",
        true,
        signal,
      ),
    enabled: !!session && !!parseRoomStartParam(startParam) && !roomId,
  });
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: ({ signal }) => runtime.http("/v1/me", profileSchema, undefined, "GET", true, signal),
    enabled: !!session,
  });
  const names = useQuery({
    queryKey: ["kahroba-room-players", roomId, room.data?.room.version],
    queryFn: ({ signal }) =>
      runtime.http(
        `/v1/kahroba/rooms/${roomId}/players`,
        z.strictObject({
          schemaVersion: z.literal(1),
          players: z
            .array(z.strictObject({ userId: z.uuid(), displayName: z.string().min(1).max(256) }))
            .max(4),
        }),
        undefined,
        "GET",
        true,
        signal,
      ),
    enabled: !!session && !!room.data?.room.members.some((m) => m.userId === session.userId),
  });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setInvite(null);
    setFeedback(null);
    setPending(false);
    return () => {
      flight.current?.abort();
      flight.current = null;
    };
  }, [roomId, session?.sessionId]);
  const value = room.data?.room,
    roomMatchesRoute =
      value?.id === roomId &&
      value?.gameId === "kahroba" &&
      [2, 3, 4].includes(value.capacity) &&
      value.members.length <= value.capacity,
    visibleRoom =
      roomMatchesRoute && value?.members.some((m) => m.userId === session?.userId)
        ? value
        : undefined,
    allowed = !!session && !room.error && canShareKahrobaRoom(visibleRoom, session.userId, now),
    validInvite = allowed && invite && invite.expiresAt > now ? invite : null;
  const lobby =
    !readiness.error && readiness.data && readiness.data.value.roomId === roomId
      ? readiness.data.value
      : undefined;
  const online = !!session && connection === "connected";
  const live = (identity: string) => runtime.store.getState().session?.sessionId === identity;
  async function refresh() {
    await Promise.all([room.refetch(), readiness.refetch()]);
  }
  function create() {
    if (!session || !permissions.data?.canCreate || roomId || task.blocked) return;
    const identity = session.sessionId,
      payload = {
        schemaVersion: 1,
        commandId: crypto.randomUUID(),
        gameId: "kahroba",
        capacity: 2,
      };
    task.run(async () => {
      const result = await runtime.http("/v1/kahroba/rooms", roomAckSchema, payload);
      if (live(identity)) go(`/restricted/kahroba/room/${result.roomId}`);
    });
  }
  function join() {
    const code = parseRoomStartParam(startParam),
      target = preview.data?.room;
    if (
      !session ||
      !code ||
      !target ||
      target.gameId !== "kahroba" ||
      !["WAITING", "FULL"].includes(target.status) ||
      target.expiresAt <= Date.now() ||
      !online ||
      task.blocked
    )
      return;
    const identity = session.sessionId,
      payload = {
        schemaVersion: 1,
        commandId: crypto.randomUUID(),
        roomId: target.id,
        expectedVersion: target.version,
        inviteCode: code,
      };
    task.run(async () => {
      await runtime.realtime().request("room:join", payload, roomAckSchema);
      if (live(identity)) go(`/restricted/kahroba/room/${target.id}`);
    });
  }
  function prepare() {
    if (
      !visibleRoom ||
      visibleRoom.status !== "FULL" ||
      visibleRoom.hostUserId !== session?.userId ||
      !online ||
      task.blocked
    )
      return;
    const identity = session.sessionId,
      payload = {
        schemaVersion: 1,
        commandId: crypto.randomUUID(),
        roomId: visibleRoom.id,
        expectedVersion: visibleRoom.version,
      };
    task.run(async () => {
      await runtime.realtime().request("room:start", payload, roomAckSchema);
      if (live(identity)) await refresh();
    });
  }
  // Freeze the completed roster through the existing host-authorized room port.
  // This only prepares a waiting match; neither readiness nor recovery launches it.
  const prepared = useRef<string | null>(null);
  useEffect(() => {
    const key = `${roomId}:${visibleRoom?.version}`;
    if (
      permissions.isSuccess &&
      visibleRoom?.status === "FULL" &&
      visibleRoom.hostUserId === session?.userId &&
      online &&
      !task.blocked &&
      prepared.current !== key
    ) {
      prepared.current = key;
      prepare();
    }
  });
  function ready() {
    if (
      !session ||
      !lobby?.matchId ||
      lobby.stateVersion === null ||
      lobby.status !== "WAITING_FOR_PLAYERS" ||
      !online ||
      task.blocked ||
      lobby.players.some((p) => p.userId === session.userId && p.ready)
    )
      return;
    const identity = session.sessionId,
      payload = {
        schemaVersion: 1,
        actionId: crypto.randomUUID(),
        matchId: lobby.matchId,
        expectedVersion: lobby.stateVersion,
      };
    task.run(async () => {
      await runtime.realtime().request("match:ready", payload, okValue(matchAckSchema));
      if (live(identity)) {
        await refresh();
        await runtime.realtime().sync();
      }
    });
  }
  function start() {
    if (
      !session ||
      !visibleRoom ||
      visibleRoom.hostUserId !== session.userId ||
      !lobby?.matchId ||
      lobby.stateVersion === null ||
      !lobby.canStart ||
      !online ||
      task.blocked
    )
      return;
    const identity = session.sessionId,
      payload = {
        schemaVersion: 1,
        actionId: crypto.randomUUID(),
        matchId: lobby.matchId,
        expectedVersion: lobby.stateVersion,
      };
    task.run(async () => {
      await runtime.http(
        `/v1/kahroba/rooms/${visibleRoom.id}/start`,
        okValue(matchAckSchema),
        payload,
      );
      if (live(identity)) {
        await refresh();
        await runtime.realtime().sync();
      }
    });
  }
  async function share() {
    if (!allowed || !session || !roomId || flight.current) return;
    const controller = new AbortController(),
      identity = session.sessionId;
    flight.current = controller;
    setPending(true);
    setInvite(null);
    setFeedback(null);
    try {
      const current = await runtime.http(
        `/v1/kahroba/rooms/${roomId}`,
        roomResponseSchema,
        undefined,
        "GET",
        true,
        controller.signal,
      );
      if (
        current.room.id !== roomId ||
        !canShareKahrobaRoom(current.room, session.userId, Date.now())
      )
        throw new ClientError("NOT_FOUND");
      const response = await runtime.http(
          `/v1/kahroba/rooms/${roomId}/invite`,
          kahrobaInviteSchema,
          undefined,
          "GET",
          true,
          controller.signal,
        ),
        verified = verifiedKahrobaInvite(response, current.room, session.userId, Date.now()),
        preview = await runtime.http(
          "/v1/kahroba/room-invites/resolve",
          previewSchema,
          { schemaVersion: 1, startParam: verified.startParam },
          "POST",
          true,
          controller.signal,
        );
      verifyKahrobaInvitePreview(preview, current.room, verified, Date.now());
      if (controller.signal.aborted || runtime.store.getState().session?.sessionId !== identity)
        return;
      setInvite(verified);
      const result = await shareKahrobaInvite(verified, {
        telegram: window.Telegram?.WebApp,
        share: navigator.share?.bind(navigator),
        copy: navigator.clipboard?.writeText.bind(navigator.clipboard),
      });
      if (controller.signal.aborted || runtime.store.getState().session?.sessionId !== identity)
        return;
      const messages = {
        telegram:
          "دعوت معتبر به انتخاب‌گر تلگرام فرستاده شد؛ حساب آزمایشی تأییدشده را انتخاب کنید.",
        shared: "دعوت معتبر به ابزار اشتراک‌گذاری فرستاده شد.",
        copied: "پیوند دعوت کپی شد؛ آن را برای حساب آزمایشی تأییدشده بفرستید.",
        cancelled: "اشتراک‌گذاری لغو شد؛ دعوت معتبر اتاق در پایین نمایش داده شده است.",
        unavailable: "ابزار اشتراک‌گذاری در دسترس نیست؛ پیوند معتبر زیر را انتخاب و کپی کنید.",
      };
      setFeedback({ text: messages[result], error: false });
    } catch (error) {
      if (!controller.signal.aborted && runtime.store.getState().session?.sessionId === identity)
        setFeedback({ text: `دعوت معتبری دریافت نشد. ${errorMessage(error, "fa")}`, error: true });
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        setPending(false);
      }
    }
  }
  let message = "",
    error = false;
  if (!session) message = "برای دریافت اطلاعات اتاق و دعوت، ورود معتبر تلگرام لازم است.";
  else if (!roomId && !startParam && current.isPending) message = "در حال بازیابی اتاق شما…";
  else if (!roomId && !startParam && current.error) {
    message = `بازیابی اتاق در دسترس نیست. ${errorMessage(current.error, "fa")}`;
    error = true;
  } else if (!roomId)
    message = startParam
      ? preview.error
        ? "دعوت معتبر یا قابل دسترس نیست."
        : "برای ورود، پیوستن با دعوت را انتخاب کنید."
      : "برای آغاز، یک اتاق خصوصی دو نفره ایجاد کنید.";
  else if (room.isPending) message = "در حال دریافت اطلاعات واقعی اتاق…";
  else if (room.error) {
    message = `اطلاعات اتاق در دسترس نیست. ${errorMessage(room.error, "fa")}`;
    error = true;
  } else if (!visibleRoom) {
    message = "اتاق معتبر کهربا و عضویت تأییدشده لازم است.";
    error = true;
  } else if (!allowed)
    message =
      visibleRoom.hostUserId !== session.userId
        ? "فقط میزبان می‌تواند دعوت معتبر اتاق را به اشتراک بگذارد."
        : "اتاق بسته، شروع‌شده یا منقضی شده است؛ دعوت معتبر قابل دریافت نیست.";
  else if (pending) message = "در حال بررسی میزبان، عضویت و اعتبار دعوت با سرور…";
  else if (feedback) {
    message = feedback.text;
    error = feedback.error;
  }
  if (visibleRoom?.startedMatchId && readiness.error) {
    message = `وضعیت آمادگی در دسترس نیست. ${errorMessage(readiness.error, "fa")}`;
    error = true;
  }
  if (visibleRoom && lobby?.status === "WAITING_FOR_PLAYERS")
    message = "هر دو بازیکن باید آماده‌ام را انتخاب کنند.";
  if (visibleRoom && lobby?.canStart === true)
    message =
      visibleRoom.hostUserId === session?.userId
        ? "هر دو بازیکن آماده‌اند؛ بازی را شروع کنید."
        : "هر دو بازیکن آماده‌اند؛ در انتظار شروع میزبان…";
  return (
    <>
      <KahrobaLobbyView
        room={visibleRoom}
        userId={session?.userId}
        displayName={
          profile.data?.userId === session?.userId ? profile.data?.displayName : undefined
        }
        photoUrl={photoUrl}
        names={Object.fromEntries(
          (names.data?.players ?? [])
            .filter((p) => visibleRoom?.members.some((m) => m.userId === p.userId))
            .map((p) => [p.userId, p.displayName]),
        )}
        connection={connection}
        pending={pending || task.pending}
        shareEnabled={allowed}
        onShare={() => void share()}
        invite={validInvite}
        message={message}
        error={error}
        actions={{
          createEnabled:
            !!session &&
            !!permissions.data?.canCreate &&
            !permissions.error &&
            !roomId &&
            !startParam &&
            current.isSuccess &&
            !current.isFetching &&
            current.data.room === null &&
            !task.blocked,
          joinEnabled:
            online &&
            !!preview.data &&
            preview.data.room.expiresAt > now &&
            ["WAITING", "FULL"].includes(preview.data.room.status) &&
            preview.data.room.gameId === "kahroba" &&
            !preview.error &&
            !task.blocked,
          readyEnabled:
            online &&
            !task.blocked &&
            lobby?.status === "WAITING_FOR_PLAYERS" &&
            !lobby.players.some((p) => p.userId === session?.userId && p.ready),
          startEnabled:
            online &&
            !task.blocked &&
            visibleRoom?.hostUserId === session?.userId &&
            lobby?.canStart === true,
          selfReady: lobby?.players.some((p) => p.userId === session?.userId && p.ready) ?? false,
          readyUserIds: lobby?.players.filter((p) => p.ready).map((p) => p.userId) ?? [],
          onCreate: create,
          onJoin: join,
          onReady: ready,
          onStart: start,
        }}
      />
      {task.notice}
    </>
  );
}

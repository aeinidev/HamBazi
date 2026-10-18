import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { profileSchema, roomResponseSchema, previewSchema } from "../../../platform/contracts.js";
import { ClientError, errorMessage } from "../../../platform/errors.js";
import { useRuntime, useSession } from "../../../ui/shared.js";
import { KahrobaLobbyView } from "../components/lobby.js";
import { kahrobaInviteSchema } from "../runtime.js";
import {
  canShareKahrobaRoom,
  verifiedKahrobaInvite,
  verifyKahrobaInvitePreview,
  shareKahrobaInvite,
  type KahrobaLobbyInvite,
} from "../lobby-invitation.js";

export function KahrobaLobby({ roomId }: { roomId?: string | undefined }) {
  const runtime = useRuntime(),
    session = useSession((s) => s.session),
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
    refetchInterval: 10000,
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
  else if (!roomId)
    message =
      "اتاق معتبری انتخاب نشده است. برای اشتراک‌گذاری، اتاق خصوصی موجود و شناسهٔ آن لازم است؛ ایجاد و ورود به اتاق در این مرحله غیرفعال‌اند.";
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
  return (
    <KahrobaLobbyView
      room={visibleRoom}
      userId={session?.userId}
      displayName={profile.data?.userId === session?.userId ? profile.data?.displayName : undefined}
      photoUrl={photoUrl}
      names={Object.fromEntries(
        (names.data?.players ?? [])
          .filter((p) => visibleRoom?.members.some((m) => m.userId === p.userId))
          .map((p) => [p.userId, p.displayName]),
      )}
      connection={connection}
      pending={pending}
      shareEnabled={allowed}
      onShare={() => void share()}
      invite={validInvite}
      message={message}
      error={error}
    />
  );
}

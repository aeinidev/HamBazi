import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ClientError } from "../../../platform/errors.js";
import { parseRoomStartParam } from "@hambazi/contracts";
import {
  roomAckSchema,
  roomResponseSchema,
  previewSchema,
  matchAckSchema,
  okValue,
} from "../../../platform/contracts.js";
import { useRuntime, useSession, useTask, go, ErrorNotice } from "../../../ui/shared.js";

/** Separate restricted test utility. No lobby button delegates to this screen. */
export function KahrobaTesting({
  roomId,
  startParam,
}: {
  roomId?: string | undefined;
  startParam?: string | undefined;
}) {
  const r = useRuntime(),
    task = useTask("fa"),
    connection = useSession((s) => s.connection),
    snapshot = useSession((s) => s.snapshot),
    userId = useSession((s) => s.session?.userId),
    [invite, setInvite] = useState(startParam ?? ""),
    [resumeId, setResumeId] = useState("");
  const room = useQuery({
    queryKey: ["kahroba-room", roomId],
    queryFn: ({ signal }) =>
      r.http(`/v1/kahroba/rooms/${roomId}`, roomResponseSchema, undefined, "GET", true, signal),
    enabled: !!roomId,
    refetchInterval: 5000,
  });
  const value = room.data?.room,
    matchId = value?.startedMatchId;
  useEffect(() => {
    if (matchId && connection === "connected")
      void r
        .realtime()
        .subscribe(matchId)
        .catch((error: unknown) =>
          r.store.setState({
            realtimeError: error instanceof ClientError ? error : new ClientError("INTERNAL_ERROR"),
          }),
        );
  }, [r, matchId, connection]);
  useEffect(() => {
    if (
      matchId &&
      snapshot?.matchId === matchId &&
      ["ACTIVE", "FINISHED"].includes(snapshot.status)
    )
      go(`/restricted/kahroba/match/${matchId}`);
  }, [matchId, snapshot?.matchId, snapshot?.status]);
  return (
    <section className="kh-test-console" dir="rtl" aria-label="آزمایش محدود کهربا">
      <h1>آزمایش محدود کهربا</h1>
      <p>
        این صفحهٔ جداگانه فقط برای دو حساب تأییدشده است. تمام فرمان‌ها با احراز هویت و قوانین اصلی
        سرور اجرا می‌شوند.
      </p>
      {!roomId && (
        <>
          <button
            disabled={task.blocked || connection !== "connected"}
            onClick={() => {
              const input = {
                schemaVersion: 1,
                commandId: crypto.randomUUID(),
                gameId: "kahroba",
                capacity: 2,
              };
              task.run(async () => {
                const ack = await r.http("/v1/kahroba/rooms", roomAckSchema, input);
                go(`/restricted/kahroba/testing/room/${ack.roomId}`);
              });
            }}
          >
            ساخت اتاق خصوصی
          </button>
          <label>
            دعوت میزبان
            <input
              dir="ltr"
              aria-label="دعوت میزبان"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
            />
          </label>
          <button
            disabled={task.blocked || connection !== "connected" || !parseRoomStartParam(invite)}
            onClick={() => {
              const startParam = invite,
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
                    startParam,
                  });
                  if (preview.room.gameId !== "kahroba")
                    throw new Error("Invalid Kahroba invitation");
                  input = {
                    schemaVersion: 1,
                    commandId,
                    roomId: preview.room.id,
                    expectedVersion: preview.room.version,
                    inviteCode: parseRoomStartParam(startParam)!,
                  };
                }
                await r.realtime().request("room:join", input, roomAckSchema);
                go(`/restricted/kahroba/testing/room/${input.roomId}`);
              });
            }}
          >
            پیوستن به اتاق
          </button>
          <label>
            شناسهٔ اتاق موجود
            <input
              aria-label="شناسهٔ اتاق موجود"
              value={resumeId}
              dir="ltr"
              onChange={(e) => setResumeId(e.target.value)}
            />
          </label>
          <button
            disabled={!z.uuid().safeParse(resumeId).success}
            onClick={() => go(`/restricted/kahroba/testing/room/${resumeId}`)}
          >
            دریافت اتاق موجود
          </button>
        </>
      )}
      {roomId && room.isPending && <p role="status">در حال دریافت اتاق…</p>}
      {room.error && <ErrorNotice error={room.error} language="fa" />}
      {value?.gameId === "kahroba" && (
        <>
          <p>
            شناسهٔ واقعی اتاق: <bdi>{value.id}</bdi>
          </p>
          <p>
            {value.members.length} / {value.capacity} بازیکن · {value.status}
          </p>
          <p>
            برای بازگشت مستقیم، لینک ورود آزمایشی را با <bdi>kahroba_test_{value.id}</bdi> باز کنید.
          </p>
          <button onClick={() => go(`/restricted/kahroba/room/${value.id}`)}>
            نمایش لابی و اشتراک دعوت
          </button>
          {value.hostUserId === userId && ["WAITING", "FULL"].includes(value.status) && (
            <button
              disabled={task.blocked || connection !== "connected" || value.status !== "FULL"}
              onClick={() => {
                const input = {
                  schemaVersion: 1,
                  commandId: crypto.randomUUID(),
                  roomId: value.id,
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
          {matchId &&
            snapshot?.matchId === matchId &&
            snapshot.status === "WAITING_FOR_PLAYERS" && (
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
          <button onClick={() => void room.refetch()}>به‌روز کردن اتاق</button>
        </>
      )}
      {task.notice}
    </section>
  );
}

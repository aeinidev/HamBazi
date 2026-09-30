import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseRoomStartParam } from "@hambazi/contracts";
import {
  inviteSchema,
  previewSchema,
  roomAckSchema,
  roomResponseSchema,
} from "../../platform/contracts.js";
import {
  ErrorNotice,
  Loading,
  Panel,
  go,
  useRuntime,
  useSession,
  useTask,
} from "../../ui/shared.js";
export function InviteScreen() {
  const runtime = useRuntime();
  const invite = useSession((s) => s.invite);
  const connected = useSession((s) => s.connection === "connected");
  const task = useTask();
  const preview = useQuery({
    queryKey: ["invite"],
    queryFn: () =>
      runtime.http("/v1/room-invites/resolve", previewSchema, {
        schemaVersion: 1,
        startParam: invite,
      }),
    enabled: !!invite,
  });
  if (!invite || !parseRoomStartParam(invite))
    return (
      <Panel title="Invitation unavailable">
        <p>Open the invitation link your host shared in Telegram.</p>
      </Panel>
    );
  return (
    <>
      <h1>You’re invited</h1>
      {preview.isPending ? (
        <Loading />
      ) : preview.error ? (
        <ErrorNotice
          error={preview.error}
          retry={() => {
            void preview.refetch();
          }}
        />
      ) : (
        <Panel title="A place with friends">
          <p>
            {preview.data.room.capacity} players ·{" "}
            {preview.data.room.status === "FULL" ? "Room full" : "Waiting for players"}
          </p>
          <button
            disabled={task.blocked || !connected || preview.data.room.status !== "WAITING"}
            onClick={() => {
              const body = {
                schemaVersion: 1,
                commandId: crypto.randomUUID(),
                roomId: preview.data.room.id,
                expectedVersion: preview.data.room.version,
                inviteCode: parseRoomStartParam(invite),
              };
              task.run(async () => {
                const result = await runtime.realtime().request("room:join", body, roomAckSchema);
                runtime.store.setState({ invite: null });
                runtime.query.removeQueries({ queryKey: ["invite"] });
                go(`/rooms/${result.roomId}`);
              });
            }}
          >
            Join room
          </button>
          {task.notice}
        </Panel>
      )}
    </>
  );
}
export function RoomScreen({ id }: { id: string }) {
  const runtime = useRuntime();
  const userId = useSession((s) => s.session?.userId);
  const connection = useSession((s) => s.connection);
  const task = useTask();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const room = useQuery({
    queryKey: ["room", id],
    queryFn: ({ signal }) =>
      runtime.http(
        `/v1/rooms/${encodeURIComponent(id)}`,
        roomResponseSchema,
        undefined,
        "GET",
        true,
        signal,
      ),
    refetchInterval: (query) => (query.state.error ? false : 10000),
  });
  useEffect(() => {
    if (connection !== "connected") return;
    let active = true;
    void runtime
      .realtime()
      .request("room:subscribe", { schemaVersion: 1, roomId: id }, roomResponseSchema)
      .then((value) => {
        if (active) runtime.query.setQueryData(["room", id], value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [runtime, id, connection]);
  if (room.isPending) return <Loading />;
  if (room.error)
    return (
      <ErrorNotice
        error={room.error}
        retry={() => {
          void room.refetch();
        }}
      />
    );
  const value = room.data.room;
  const host = value.hostUserId === userId;
  const waiting = ["WAITING", "FULL"].includes(value.status);
  function command(kind: "start" | "leave") {
    const body = {
      schemaVersion: 1,
      commandId: crypto.randomUUID(),
      roomId: id,
      expectedVersion: value.version,
    };
    task.run(async () => {
      await runtime.realtime().request(`room:${kind}`, body, roomAckSchema);
      if (kind === "leave") {
        runtime.query.removeQueries({ queryKey: ["room", id] });
        go("/games");
      } else await runtime.query.invalidateQueries({ queryKey: ["room", id] });
    });
  }
  return (
    <>
      <p className="eyebrow">PRIVATE TABLE</p>
      <h1>Your room</h1>
      <p className="notice" role="status">
        {value.status === "STARTING"
          ? "Waiting for the server to start your match…"
          : value.status.toLowerCase().replaceAll("_", " ")}
      </p>
      <Panel title={`${value.members.length} of ${value.capacity} seats filled`}>
        <ol className="seats">
          {Array.from({ length: value.capacity }, (_, seat) => {
            const member = value.members.find((m) => m.seat === seat);
            return (
              <li key={seat}>
                <span className="seat-number">{seat + 1}</span>
                <span>
                  {member ? (member.userId === userId ? "You" : `Player ${seat + 1}`) : "Open seat"}
                </span>
                {member?.userId === value.hostUserId && <span className="tag">Host</span>}
              </li>
            );
          })}
        </ol>
        {host && waiting && (
          <button
            className="secondary"
            disabled={task.blocked}
            onClick={() =>
              task.run(async () => {
                const result = await runtime.http(
                  `/v1/rooms/${encodeURIComponent(id)}/invite`,
                  inviteSchema,
                );
                setLink(result.invite.deepLink);
                setCopied(false);
              })
            }
          >
            Get invite link
          </button>
        )}
        {link && host && waiting && (
          <div className="share">
            <label>
              Invite link
              <input value={link} readOnly onFocus={(e) => e.target.select()} dir="ltr" />
            </label>
            <button
              className="secondary"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(link)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        )}
        <div className="actions">
          {host && waiting && (
            <button
              disabled={task.blocked || connection !== "connected" || value.status !== "FULL"}
              onClick={() => command("start")}
            >
              Start match
            </button>
          )}
          {waiting && (
            <button
              className="secondary"
              disabled={task.blocked || connection !== "connected"}
              onClick={() => command("leave")}
            >
              Leave room
            </button>
          )}
          {value.startedMatchId && (
            <a className="button" href={`#/match/${value.startedMatchId}`}>
              Open match
            </a>
          )}
        </div>
        {task.notice}
        <button
          className="text-button"
          onClick={() => {
            void room.refetch();
          }}
        >
          Refresh room
        </button>
      </Panel>
    </>
  );
}

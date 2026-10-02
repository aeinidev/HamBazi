import { MatchChat } from "../features/chat/index.js";
import { useEffect } from "react";
import { matchAckSchema, okValue } from "./contracts.js";
import { ClientError } from "./errors.js";
import { ErrorNotice, Loading, Panel, useRuntime, useSession, useTask } from "../ui/shared.js";
import { CoupMatch } from "../games/coup/index.js";
export function MatchScreen({ id }: { id: string }) {
  const runtime = useRuntime();
  const snapshot = useSession((s) => s.snapshot);
  const connection = useSession((s) => s.connection);
  const error = useSession((s) => s.realtimeError);
  const resyncNeeded = useSession((s) => s.resyncNeeded);
  const task = useTask();
  useEffect(() => {
    if (connection === "connected")
      void runtime
        .realtime()
        .subscribe(id)
        .catch((error: unknown) =>
          runtime.store.setState({
            realtimeError: error instanceof ClientError ? error : new ClientError("INTERNAL_ERROR"),
          }),
        );
  }, [id, runtime, connection]);
  const current = snapshot?.matchId === id ? snapshot : null;
  useEffect(() => {
    if (current?.status === "FINISHED")
      void runtime.query.invalidateQueries({ queryKey: ["statistics"] });
  }, [runtime, id, current?.status]);
  return (
    <>
      <p className="eyebrow">YOUR TABLE</p>
      <h1>Match session</h1>
      {error && (
        <ErrorNotice
          error={error}
          retry={() => {
            void runtime.realtime().sync();
          }}
        />
      )}
      {!current ? (
        resyncNeeded ? (
          <p className="notice" role="status">
            Synchronizing the table…
          </p>
        ) : (
          <Loading />
        )
      ) : (
        <Panel title={current.role === "SPECTATOR" ? "Watching the table" : "At the table"}>
          <p role="status">{current.status.toLowerCase().replaceAll("_", " ")}</p>
          {current.role === "SPECTATOR" && (
            <p>You are watching this match. Player controls are unavailable.</p>
          )}
          {current.role === "PLAYER" && current.status === "WAITING_FOR_PLAYERS" && (
            <button
              disabled={task.blocked || connection !== "connected"}
              onClick={() => {
                const body = {
                  schemaVersion: 1,
                  actionId: crypto.randomUUID(),
                  matchId: id,
                  expectedVersion: current.stateVersion,
                };
                task.run(async () => {
                  await runtime.realtime().request("match:ready", body, okValue(matchAckSchema));
                  await runtime.realtime().sync();
                });
              }}
            >
              I’m ready
            </button>
          )}
          {(current.status === "ACTIVE" || current.status === "FINISHED") &&
          current.gameId === "coup" ? (
            <CoupMatch snapshot={current} />
          ) : (
            <p className="quiet">Match status is synchronized with the server.</p>
          )}
          {current.status === "FINISHED" && (
            <p>
              <a href="#/profile">View your statistics</a> ·{" "}
              <a href="#/leaderboard/coup">Coup leaderboard</a>
            </p>
          )}
          {task.notice}
        </Panel>
      )}
      <MatchChat
        key={`${id}:${runtime.store.getState().session?.sessionId ?? "none"}`}
        matchId={id}
      />
    </>
  );
}

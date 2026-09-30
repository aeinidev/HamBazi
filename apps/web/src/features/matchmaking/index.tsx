import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  foundSchema,
  matchReferenceSchema,
  okValue,
  ticketSchema,
} from "../../platform/contracts.js";
import { ErrorNotice, Panel, go, useRuntime, useSession, useTask } from "../../ui/shared.js";
export function MatchmakingScreen() {
  const runtime = useRuntime();
  const ticket = useSession((s) => s.ticket);
  const connected = useSession((s) => s.connection === "connected");
  const task = useTask();
  const status = useQuery({
    queryKey: ["ticket", ticket?.ticketId],
    queryFn: () =>
      runtime
        .realtime()
        .request(
          "matchmaking:status",
          { schemaVersion: 1, ticketId: ticket!.ticketId },
          okValue(ticketSchema),
        ),
    enabled: !!ticket && connected,
    refetchInterval: (query) =>
      query.state.error ||
      ["MATCHED", "CANCELLED", "EXPIRED"].includes(query.state.data?.value.status ?? "")
        ? false
        : 5000,
  });
  useEffect(() => {
    if (status.data) runtime.store.setState({ ticket: status.data.value });
  }, [runtime, status.data]);
  if (!ticket)
    return (
      <Panel title="Find your next table">
        <p>Choose a game and a mode to find players.</p>
        <a href="#/games">Browse games</a>
      </Panel>
    );
  const terminal = ["CANCELLED", "EXPIRED"].includes(ticket.status);
  return (
    <>
      <p className="eyebrow">ONLINE PLAY</p>
      <h1>
        {ticket.status === "MATCHED"
          ? "Your table is ready"
          : terminal
            ? "Search ended"
            : "Finding your people…"}
      </h1>
      <Panel
        title={
          ticket.status === "RESERVED"
            ? "Confirming your table"
            : ticket.status === "MATCHED"
              ? "Match found"
              : terminal
                ? "Ready when you are"
                : "Looking for players"
        }
      >
        <p role="status">
          {terminal
            ? "Return to the games list to start another search."
            : ticket.status === "MATCHED"
              ? "Your place is reserved. Join when you’re ready."
              : "You can cancel while the server is finding your table."}
        </p>
        {ticket.status === "MATCHED" ? (
          <button
            disabled={task.blocked || !connected}
            onClick={() =>
              task.run(async () => {
                const found = await runtime
                  .realtime()
                  .request(
                    "matchmaking:found",
                    { schemaVersion: 1, ticketId: ticket.ticketId },
                    okValue(foundSchema),
                  );
                await runtime.realtime().request(
                  "matchmaking:admit",
                  {
                    schemaVersion: 1,
                    ticketId: ticket.ticketId,
                    admissionToken: found.value.admissionToken,
                  },
                  okValue(matchReferenceSchema),
                );
                go(`/match/${found.value.matchId}`);
              })
            }
          >
            Join match
          </button>
        ) : (
          !terminal && (
            <button
              className="secondary"
              disabled={task.blocked || !connected}
              onClick={() =>
                task.run(async () => {
                  const result = await runtime
                    .realtime()
                    .request(
                      "matchmaking:cancel",
                      { schemaVersion: 1, ticketId: ticket.ticketId },
                      okValue(ticketSchema),
                    );
                  runtime.store.setState({ ticket: result.value });
                  runtime.query.setQueryData(["ticket", ticket.ticketId], result);
                })
              }
            >
              Cancel search
            </button>
          )
        )}
        {terminal && <a href="#/games">Back to games</a>}
        {task.notice}
        {status.error && (
          <ErrorNotice
            error={status.error}
            retry={() => {
              void status.refetch();
            }}
          />
        )}
      </Panel>
    </>
  );
}

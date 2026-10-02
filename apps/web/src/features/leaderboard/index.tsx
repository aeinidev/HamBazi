import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorNotice, Loading, Panel, useRuntime } from "../../ui/shared.js";
import { ClientError } from "../../platform/errors.js";
import { ownStatsSchema, leaderboardSchema } from "./contracts.js";
function periodTitle(period: string) {
  return period === "all_time" ? "All time" : `Week starting ${period.slice(5)} (UTC)`;
}
export function OwnStatistics() {
  const runtime = useRuntime();
  const [period, setPeriod] = useState("all_time");
  const stats = useQuery({
    queryKey: ["statistics", "own", period],
    queryFn: ({ signal }) =>
      runtime.http(`/v1/me/stats?period=${period}`, ownStatsSchema, undefined, "GET", true, signal),
  });
  return (
    <Panel title="Your statistics">
      <label>
        Statistics period
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="all_time">All time</option>
          <option value="weekly">This week (UTC)</option>
        </select>
      </label>
      {stats.isPending ? (
        <Loading />
      ) : stats.error ? (
        <ErrorNotice
          error={stats.error}
          retry={() => {
            void stats.refetch();
          }}
        />
      ) : (
        <>
          <p className="quiet">
            {periodTitle(stats.data.period)} · Finished results may take a moment to appear.
          </p>
          {stats.data.games.length === 0 ? (
            <p>No completed games in this period.</p>
          ) : (
            <dl>
              {stats.data.games.map((g) => (
                <div key={g.gameId}>
                  <dt>{g.gameId === "coup" ? "Coup" : g.gameId}</dt>
                  <dd>
                    Played: {g.completed} · Wins: {g.wins} · Losses: {g.losses}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
      <button
        className="text-button"
        onClick={() => {
          void stats.refetch();
        }}
      >
        Refresh statistics
      </button>
      <p>
        <a href="#/leaderboard/coup">Coup leaderboard</a>
      </p>
    </Panel>
  );
}
export function LeaderboardScreen({ gameId }: { gameId: string }) {
  const runtime = useRuntime();
  const [period, setPeriod] = useState("all_time");
  const [offset, setOffset] = useState(0);
  const board = useQuery({
    queryKey: ["statistics", "board", gameId, period, offset],
    queryFn: async ({ signal }) => {
      const page = await runtime.http(
        `/v1/leaderboards/${encodeURIComponent(gameId)}?period=${period}&offset=${offset}&limit=50`,
        leaderboardSchema,
        undefined,
        "GET",
        true,
        signal,
      );
      if (page.gameId !== gameId || (page.nextOffset !== null && page.nextOffset <= offset))
        throw new ClientError("INVALID_RESPONSE");
      return page;
    },
  });
  return (
    <>
      <h1>{gameId === "coup" ? "Coup leaderboard" : "Leaderboard"}</h1>
      <Panel title="Most wins">
        <label>
          Leaderboard period
          <select
            value={period}
            onChange={(e) => {
              setOffset(0);
              setPeriod(e.target.value);
            }}
          >
            <option value="all_time">All time</option>
            <option value="weekly">This week (UTC)</option>
          </select>
        </label>
        {board.isPending ? (
          <Loading />
        ) : board.error ? (
          <ErrorNotice
            error={board.error}
            retry={() => {
              void board.refetch();
            }}
          />
        ) : (
          <>
            <p className="quiet">
              {periodTitle(board.data.period)} · Equal wins share a rank. Rankings can change as
              results arrive.
            </p>
            {board.data.entries.length === 0 ? (
              <p>No completed games in this period.</p>
            ) : (
              <table className="leaderboard-table">
                <caption className="quiet">Coup wins</caption>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Player</th>
                    <th scope="col">Wins</th>
                  </tr>
                </thead>
                <tbody>
                  {board.data.entries.map((entry) => (
                    <tr key={entry.userId}>
                      <td>{entry.rank}</td>
                      <td>
                        <bdi>{entry.displayName}</bdi>
                      </td>
                      <td>{entry.wins}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="actions">
              <button
                className="secondary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous page
              </button>
              <button
                className="secondary"
                disabled={board.data.nextOffset === null}
                onClick={() => setOffset(board.data.nextOffset ?? offset)}
              >
                Next page
              </button>
            </div>
          </>
        )}
        <button
          className="text-button"
          onClick={() => {
            if (offset) setOffset(0);
            else void board.refetch();
          }}
        >
          Refresh leaderboard
        </button>
      </Panel>
    </>
  );
}
export { ownStatsSchema, leaderboardSchema } from "./contracts.js";

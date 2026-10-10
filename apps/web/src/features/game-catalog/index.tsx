import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  catalogSchema,
  gameResponseSchema,
  okValue,
  roomAckSchema,
  ticketSchema,
  type Game,
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
export function CatalogScreen() {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: ["catalog"],
    queryFn: ({ signal }) =>
      runtime.http("/v1/games", catalogSchema, undefined, "GET", true, signal),
  });
  return (
    <>
      <p className="eyebrow">PICK YOUR TABLE</p>
      <h1>Games</h1>
      <p className="intro">A little strategy. A little bluff. Good company.</p>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorNotice
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <div className="game-grid">
          {query.data.games.map((game) => (
            <a
              key={game.id}
              className="game-card"
              href={`#/games/${encodeURIComponent(game.slug)}`}
            >
              <span className="tag">
                {game.playable && game.status === "ACTIVE"
                  ? "Ready to play"
                  : game.status === "MAINTENANCE"
                    ? "Maintenance"
                    : "Coming soon"}
              </span>
              <h2>{game.title}</h2>
              <p>
                {game.minPlayers}–{game.maxPlayers} players
              </p>
              <span className="card-link">
                View lobby <span aria-hidden="true">↗</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
function Lobby({ game }: { game: Game }) {
  const runtime = useRuntime();
  const task = useTask();
  const connected = useSession((s) => s.connection === "connected");
  const ticket = useSession((s) => s.ticket);
  const [capacity, setCapacity] = useState(game.minPlayers);
  const [mode, setMode] = useState(game.matchmakingModes?.[0]?.id ?? "");
  const available = game.playable && game.status === "ACTIVE";
  const modes = game.matchmakingModes ?? [];
  const validMode = modes.some((item) => item.id === mode);
  const activeTicket = ticket && ["SEARCHING", "RESERVED", "MATCHED"].includes(ticket.status);
  return (
    <>
      <p className="eyebrow">GAME LOBBY</p>
      <h1>{game.title}</h1>
      {!available && (
        <p className="notice" role="status">
          {game.status === "MAINTENANCE"
            ? "This game is under maintenance."
            : "This game is not accepting players yet."}
        </p>
      )}
      <Panel title="Set your table">
        <label>
          Players
          <select
            value={capacity}
            disabled={task.blocked}
            onChange={(e) => setCapacity(Number(e.target.value))}
          >
            {Array.from(
              { length: Math.max(0, game.maxPlayers - game.minPlayers + 1) },
              (_, i) => game.minPlayers + i,
            ).map((n) => (
              <option key={n} value={n}>
                {n} players
              </option>
            ))}
          </select>
        </label>
        <label>
          Mode
          <select
            value={mode}
            disabled={task.blocked || modes.length === 0}
            onChange={(e) => setMode(e.target.value)}
          >
            {modes.length === 0 && <option value="">No modes available</option>}
            {modes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button
            disabled={
              task.blocked ||
              !available ||
              !game.matchmakingEnabled ||
              !validMode ||
              !connected ||
              !!activeTicket
            }
            onClick={() => {
              const body = {
                schemaVersion: 1,
                commandId: crypto.randomUUID(),
                gameId: game.id,
                mode,
                capacity,
              };
              task.run(async () => {
                const result = await runtime
                  .realtime()
                  .request("matchmaking:search", body, okValue(ticketSchema));
                runtime.store.setState({ ticket: result.value });
                go("/search");
              });
            }}
          >
            Find players
          </button>
          <button
            className="secondary"
            disabled={task.blocked || !available || !game.privateRoomsEnabled}
            onClick={() => {
              const body = {
                schemaVersion: 1,
                commandId: crypto.randomUUID(),
                gameId: game.id,
                capacity,
              };
              task.run(async () => {
                const result = await runtime.http("/v1/rooms", roomAckSchema, body);
                go(`/rooms/${result.roomId}`);
              });
            }}
          >
            Invite friends
          </button>
        </div>
        {activeTicket && <a href="#/search">Return to your search</a>}
        {task.notice}
      </Panel>
    </>
  );
}
export function LobbyScreen({ slug }: { slug: string }) {
  const runtime = useRuntime();
  const query = useQuery({
    queryKey: ["game", slug],
    queryFn: ({ signal }) =>
      runtime.http(
        `/v1/games/${encodeURIComponent(slug)}`,
        gameResponseSchema,
        undefined,
        "GET",
        true,
        signal,
      ),
  });
  return query.isPending ? (
    <Loading />
  ) : query.error ? (
    <ErrorNotice
      error={query.error}
      retry={() => {
        void query.refetch();
      }}
    />
  ) : (
    <Lobby key={query.data.game.id} game={query.data.game} />
  );
}
export { PersonalLobbyShell } from "./personal-shell.js";

import type { Snapshot } from "../../../platform/contracts.js";
import { matchAckSchema, okValue } from "../../../platform/contracts.js";
import { ClientError } from "../../../platform/errors.js";
import { useRuntime, useSession, useTask } from "../../../ui/shared.js";
import { toCoupView, type CoupCommand, type CoupView } from "../adapters/index.js";
import { Table } from "../components/index.js";
import { useExchangeSelection } from "../store/index.js";

function commandLabel(command: CoupCommand, view: CoupView) {
  const target =
    "targetId" in command
      ? ` → Seat ${(view.players.find((player) => player.id === command.targetId)?.seat ?? -1) + 1}`
      : "";
  const card =
    "cardIndex" in command && view.kind === "PLAYER"
      ? ` · ${view.myCards[command.cardIndex] ?? `card ${command.cardIndex + 1}`}`
      : "";
  const block = "role" in command ? ` · ${command.role}` : "";
  return `${command.type.replaceAll("_", " ").toLowerCase()}${target}${block}${card}`;
}

export function CoupMatch({ snapshot }: { snapshot: Snapshot }) {
  const session = useSession((state) => state.session);
  const connection = useSession((state) => state.connection);
  const resyncNeeded = useSession((state) => state.resyncNeeded);
  const view = session ? toCoupView(snapshot, session.userId) : null;
  if (!view)
    return (
      <div className="notice error" role="alert">
        This match needs a newer version of the app.
      </div>
    );
  return (
    <CoupContent
      key={`${snapshot.matchId}:${snapshot.stateVersion}:${view.kind}`}
      snapshot={snapshot}
      view={view}
      available={connection === "connected" && !resyncNeeded}
    />
  );
}

function CoupContent({
  snapshot,
  view,
  available,
}: {
  snapshot: Snapshot;
  view: CoupView;
  available: boolean;
}) {
  const runtime = useRuntime();
  const task = useTask();
  const commands = view.kind === "PLAYER" ? view.legalCommands : [];
  const exchange = useExchangeSelection(view.revision, commands);
  function send(command: CoupCommand) {
    const body = {
      schemaVersion: 1,
      actionId: crypto.randomUUID(),
      matchId: snapshot.matchId,
      expectedVersion: snapshot.stateVersion,
      command,
    };
    task.run(async () => {
      try {
        await runtime.realtime().request("game:command", body, okValue(matchAckSchema));
      } catch (error) {
        if (error instanceof ClientError && error.code === "GAME_STATE_CONFLICT")
          await runtime.realtime().sync();
        throw error;
      }
      await runtime.realtime().sync();
    });
  }
  const canAct =
    available && snapshot.status === "ACTIVE" && view.kind === "PLAYER" && !task.blocked;
  return (
    <>
      <Table view={view} />
      {view.kind === "SPECTATOR" && (
        <p className="notice" role="status">
          Spectator view. Player controls are unavailable.
        </p>
      )}
      {!available && (
        <p className="notice" role="status">
          Reconnecting and synchronizing the table…
        </p>
      )}
      {view.kind === "PLAYER" && snapshot.status === "ACTIVE" && (
        <section aria-label="Available actions">
          <h3>Available actions</h3>
          {commands.length === 0 && <p>Waiting for another player or the server.</p>}
          <div className="coup-actions">
            {commands
              .filter((command) => command.type !== "SELECT_EXCHANGE")
              .map((command, index) => (
                <button
                  key={`${command.type}:${index}`}
                  disabled={!canAct}
                  onClick={() => send(command)}
                >
                  {commandLabel(command, view)}
                </button>
              ))}
          </div>
          {view.exchangeChoices &&
            commands.some((command) => command.type === "SELECT_EXCHANGE") && (
              <fieldset className="coup-exchange">
                <legend>Choose cards to keep</legend>
                <div className="coup-choices">
                  {view.exchangeChoices.map((card, index) => (
                    <label key={index}>
                      <input
                        type="checkbox"
                        checked={exchange.indices.includes(index)}
                        disabled={!canAct}
                        onChange={() => exchange.toggle(index)}
                      />
                      Card {index + 1}: {card}
                    </label>
                  ))}
                </div>
                <button
                  disabled={!canAct || !exchange.selected}
                  onClick={() => {
                    if (exchange.selected) send(exchange.selected);
                  }}
                >
                  Keep selected cards
                </button>
              </fieldset>
            )}
          {task.notice}
        </section>
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import type { CoupView } from "../adapters/index.js";

export function Countdown({ deadlineAt }: { deadlineAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (deadlineAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadlineAt]);
  if (deadlineAt === null) return null;
  return (
    <p className="coup-timer" role="timer">
      Server deadline: {Math.max(0, Math.ceil((deadlineAt - now) / 1000))}s
    </p>
  );
}

export function Table({ view }: { view: CoupView }) {
  const name = (id: string) => {
    const player = view.players.find((entry) => entry.id === id);
    return player ? `Seat ${player.seat + 1}` : "Unknown seat";
  };
  return (
    <>
      <div className="coup-table" aria-label="Coup table">
        {view.players.map((player) => (
          <section className="coup-seat" key={player.id} aria-label={`Seat ${player.seat + 1}`}>
            <h3>
              {name(player.id)}
              {view.kind === "PLAYER" && player.id === view.viewerId ? " · You" : ""}
            </h3>
            <p>
              {player.coins} coins · {player.cardsRemaining} cards
            </p>
            <div className="coup-cards" aria-label="Public cards">
              {player.revealed.map((card, index) => (
                <span className="coup-card revealed" key={index}>
                  {card}
                </span>
              ))}
              {Array.from({ length: player.cardsRemaining }, (_, index) => (
                <span className="coup-card hidden" key={index} aria-label="Hidden card">
                  ?
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
      {view.kind === "PLAYER" && (
        <section aria-label="Your cards" className="coup-hand">
          <h3>Your cards</h3>
          <div className="coup-cards">
            {view.myCards.map((card, index) => (
              <span className="coup-card" key={index}>
                {card}
              </span>
            ))}
          </div>
        </section>
      )}
      <p className="quiet" role="status">
        Turn {view.turnNumber} · {name(view.turnPlayerId)} to act ·{" "}
        {view.phase.toLowerCase().replaceAll("_", " ")}
      </p>
      {view.pendingAction && (
        <p>
          {name(view.pendingAction.actorId)}:{" "}
          {view.pendingAction.kind.toLowerCase().replaceAll("_", " ")}
          {view.pendingAction.targetId ? ` → ${name(view.pendingAction.targetId)}` : ""}
        </p>
      )}
      {view.window?.claim && (
        <p>
          {name(view.window.claim.claimantId)} claims {view.window.claim.role}.
        </p>
      )}
      {view.proof && <p>{name(view.proof.challengerId)} challenged the claim.</p>}
      {view.loss && (
        <p>
          {name(view.loss.playerId)} must lose a card ({view.loss.reason.toLowerCase()}).
        </p>
      )}
      {view.phase === "GAME_OVER" && (
        <p role="status">
          {view.winnerId ? `${name(view.winnerId)} won the match.` : "Match ended."}
        </p>
      )}
      <Countdown deadlineAt={view.deadlineAt} />
    </>
  );
}

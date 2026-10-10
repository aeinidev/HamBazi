import { useEffect, useState } from "react";
import type { CoupView } from "../adapters/index.js";
import { CardBack, CoinIcon, InfluenceCard } from "./cards.js";
export const persianNumber = (n: number) => n.toLocaleString("fa-IR");
export const actionNames = {
  INCOME: "درآمد",
  FOREIGN_AID: "کمک خارجی",
  COUP: "کودتا",
  TAX: "مالیات",
  STEAL: "سرقت",
  ASSASSINATION: "آدمکشی",
  EXCHANGE: "تعویض",
  ANARCHIST: "آنارشیست",
};
export function Countdown({ deadlineAt }: { deadlineAt: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (deadlineAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadlineAt]);
  return deadlineAt === null ? null : (
    <span className="table-countdown" role="timer" aria-label="زمان باقی‌مانده">
      {persianNumber(Math.max(0, Math.ceil((deadlineAt - now) / 1000)))}
      <small>ثانیه</small>
    </span>
  );
}
type Player = CoupView["players"][number];
export function seatName(view: CoupView, id: string, personal = false) {
  const p = view.players.find((p) => p.id === id);
  if (p && "displayName" in p && typeof p.displayName === "string" && p.displayName)
    return p.displayName;
  if (view.kind === "PLAYER" && id === view.viewerId) return "شما";
  if (personal && view.players.length === 2) return "ربات";
  return p ? `بازیکن ${persianNumber(p.seat + 1)}` : "بازیکن";
}
function Seat({
  player,
  view,
  personal,
  defending,
}: {
  player: Player;
  view: CoupView;
  personal: boolean;
  defending: string | null;
}) {
  const name = seatName(view, player.id, personal),
    eliminated = player.cardsRemaining === 0;
  return (
    <section
      className={`table-seat ${view.turnPlayerId === player.id ? "current-turn" : ""} ${eliminated ? "eliminated" : ""} ${view.pendingAction?.targetId === player.id ? "targeted" : ""}`}
      aria-label={name}
    >
      <span className="seat-avatar" aria-hidden="true">
        {"displayName" in player && typeof player.displayName === "string" && player.displayName
          ? [...name][0]
          : personal && view.players.length === 2
            ? "◆"
            : persianNumber(player.seat + 1)}
      </span>
      <span className="seat-name" title={name}>
        {name}
      </span>
      <div className="seat-influences" role="group" aria-label="نفوذهای عمومی">
        {Array.from({ length: player.cardsRemaining }, (_, i) => (
          <CardBack key={i} />
        ))}
        {player.revealed.map((role, i) => (
          <InfluenceCard key={`lost-${i}`} role={role} lost />
        ))}
      </div>
      <span className="seat-coins">
        <CoinIcon />
        {persianNumber(player.coins)}
      </span>
      {eliminated && <span className="seat-state">حذف‌شده</span>}
      {defending === player.id && (
        <div className="defense-reveal" role="status">
          <InfluenceCard role="CONTESSA" />
          <span>دفاع شاه‌دخت</span>
        </div>
      )}
    </section>
  );
}
const phaseNames: Record<CoupView["phase"], string> = {
  WAITING_FOR_ACTION: "نوبت اقدام",
  CHALLENGE: "پاسخ به ادعا",
  BLOCK: "فرصت مسدودسازی",
  PROOF: "اثبات ادعا",
  LOSS: "انتخاب نفوذ برای از دست دادن",
  EXCHANGE: "انتخاب کارت‌های نگه‌داشتنی",
  GAME_OVER: "بازی تمام شد",
};
export function Table({
  view,
  personal = false,
  defending = null,
}: {
  view: CoupView;
  personal?: boolean;
  defending?: string | null;
}) {
  const opponents = view.players.filter((p) => view.kind !== "PLAYER" || p.id !== view.viewerId);
  const sides = opponents.length >= 4 ? opponents.slice(-2) : [];
  const top = opponents.slice(0, opponents.length - sides.length);
  const action =
    "lastAction" in view
      ? view.lastAction
      : view.pendingAction
        ? { ...view.pendingAction, outcome: "DECLARED" }
        : null;
  const reaction =
    view.window?.eligibleIds.filter((id) => !view.window!.passedIds.includes(id)) ?? [];
  const acting =
    view.phase === "WAITING_FOR_ACTION"
      ? seatName(view, view.turnPlayerId, personal)
      : reaction.map((id) => seatName(view, id, personal)).join("، ");
  const publicText = action
    ? `${seatName(view, action.actorId, personal)}: ${actionNames[action.kind]}${action.targetId ? ` ← ${seatName(view, action.targetId, personal)}` : ""}${action.outcome === "DEFENDED" ? "؛ دفاع شاه‌دخت" : ""}`
    : "بازی آغاز شد";
  return (
    <div className="game-table-stage" data-player-count={view.players.length}>
      <div className="opponents-top">
        {top.map((p) => (
          <Seat key={p.id} player={p} view={view} personal={personal} defending={defending} />
        ))}
      </div>
      <div className={`table-middle ${sides.length ? "with-sides" : ""}`}>
        {sides[0] && (
          <Seat player={sides[0]} view={view} personal={personal} defending={defending} />
        )}
        <div className="oval-table" aria-hidden="true">
          <div className="decorative-deck">
            <CardBack />
            <CardBack />
          </div>
          <CoinIcon />
        </div>
        {sides[1] && (
          <Seat player={sides[1]} view={view} personal={personal} defending={defending} />
        )}
      </div>
      <p className="public-action-line" role="status" title={publicText}>
        {publicText}
      </p>
      <div className="table-turn-status" role="status">
        <span>
          {view.phase === "GAME_OVER"
            ? view.winnerId
              ? `${seatName(view, view.winnerId, personal)} برنده شد`
              : phaseNames.GAME_OVER
            : `${acting} · ${phaseNames[view.phase]}`}
        </span>
        <Countdown deadlineAt={view.deadlineAt} />
      </div>
    </div>
  );
}

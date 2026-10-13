import type { CSSProperties } from "react";
import {
  GEM_COLORS,
  TOKEN_COLORS,
  type DevelopmentCard,
  type PublicPlayer,
  type KahrobaView,
  type TokenColor,
  type Noble,
} from "../adapters/index.js";
import { kahrobaAssets, gemNames } from "../assets.js";
export type PublicNames = Readonly<Record<string, string>>;
export const seatName = (id: string, view: KahrobaView, names: PublicNames) =>
  names[id] ?? `بازیکن ${(view.players.find((p) => p.id === id)?.seat ?? 0) + 1}`;
export function Num({ value }: { value: number | string }) {
  return (
    <bdi className="kh-num" dir="ltr">
      {String(value)}
    </bdi>
  );
}
export function Gem({ color, bonus = false }: { color: TokenColor; bonus?: boolean }) {
  return bonus ? (
    <span role="img" aria-label={`کارت ${gemNames[color]}`} className={`kh-bonus kh-${color}`}>
      <svg viewBox="0 0 20 24" aria-hidden="true">
        <path d="M3 5h12v16H3zM6 2h12v16" />
      </svg>
    </span>
  ) : (
    <img
      className="kh-gem"
      src={kahrobaAssets.token(color)}
      alt={gemNames[color]}
      width="128"
      height="128"
      draggable={false}
    />
  );
}
export function Resources({
  values,
  bonus = false,
  gold = true,
}: {
  values: Record<string, number>;
  bonus?: boolean;
  gold?: boolean;
}) {
  return (
    <div className="kh-resources" dir="ltr">
      {(gold ? TOKEN_COLORS : GEM_COLORS).map((c) => (
        <span key={c} title={gemNames[c]}>
          <Gem color={c} bonus={bonus} />
          <Num value={values[c] ?? 0} />
        </span>
      ))}
    </div>
  );
}
export function DevelopmentTile({
  card,
  selected = false,
  affordable = false,
  onSelect,
  compact = false,
}: {
  card: DevelopmentCard;
  selected?: boolean;
  affordable?: boolean;
  onSelect?: (card: DevelopmentCard) => void;
  compact?: boolean;
}) {
  const content = (
    <>
      <img
        className="kh-card-art"
        src={kahrobaAssets.art(card.bonus)}
        alt=""
        width="384"
        height="512"
        draggable={false}
      />
      <span className="kh-card-top">
        <Gem color={card.bonus} />
        <span className="kh-prestige">
          <Num value={card.prestige} />
        </span>
      </span>
      <span className="kh-card-cost" dir="ltr">
        {GEM_COLORS.filter((c) => card.cost[c] > 0).map((c) => (
          <span key={c}>
            <Gem color={c} />
            <Num value={card.cost[c]} />
          </span>
        ))}
      </span>
      {affordable && (
        <span role="img" className="kh-afford" aria-label="قابل خرید">
          ✓
        </span>
      )}
    </>
  );
  const className = `kh-card kh-${card.bonus}${selected ? " selected" : ""}${compact ? " compact" : ""}`;
  return onSelect ? (
    <button
      className={className}
      aria-pressed={selected}
      aria-label={`کارت ${gemNames[card.bonus]}، سطح ${card.tier}، امتیاز ${card.prestige}${affordable ? "، قابل خرید" : ""}`}
      data-card-id={card.id}
      onClick={() => onSelect(card)}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
export function PlayerStrip({
  view,
  viewerId,
  names,
}: {
  view: KahrobaView;
  viewerId: string;
  names: PublicNames;
}) {
  return (
    <section className="kh-players" aria-label="بازیکنان">
      {view.players
        .filter((p) => p.id !== viewerId)
        .map((p) => (
          <article key={p.id} className={p.id === view.turnPlayerId ? "current" : ""}>
            <div className="kh-player-heading">
              <img
                src={kahrobaAssets.noble(`kahroba-noble-0${p.seat}`)}
                alt=""
                width="40"
                height="40"
              />
              <bdi dir="auto" title={seatName(p.id, view, names)}>
                {seatName(p.id, view, names)}
              </bdi>
              <span className="kh-score">
                ★ <Num value={p.prestige} />
              </span>
            </div>
            <Resources values={p.tokens} />
            <Resources values={p.bonuses} bonus gold={false} />
            {p.id === view.turnPlayerId && (
              <span role="img" className="kh-turn-dot" aria-label="نوبت این بازیکن" />
            )}
          </article>
        ))}
    </section>
  );
}
export function NobleTile({ noble, onSelect }: { noble: Noble; onSelect?: (n: Noble) => void }) {
  return (
    <button
      className="kh-noble"
      aria-label={`اشراف، امتیاز ${noble.prestige}`}
      onClick={() => onSelect?.(noble)}
    >
      <img src={kahrobaAssets.noble(noble.id)} alt="" width="384" height="512" />
      <span className="kh-prestige">
        <Num value={noble.prestige} />
      </span>
      <span className="kh-noble-cost" dir="ltr">
        {GEM_COLORS.filter((c) => noble.requirements[c] > 0).map((c) => (
          <span key={c}>
            <Gem color={c} bonus />
            <Num value={noble.requirements[c]} />
          </span>
        ))}
      </span>
    </button>
  );
}
export function NobleRail({ view, onSelect }: { view: KahrobaView; onSelect(n: Noble): void }) {
  return (
    <section
      className="kh-nobles"
      aria-label="اشراف موجود"
      style={{ "--nobles": Math.max(1, view.nobles.length) } as CSSProperties}
    >
      <span className="kh-tier kh-crown" aria-hidden="true">
        ♛
      </span>
      <div>
        {view.nobles.map((n) => (
          <NobleTile key={n.id} noble={n} onSelect={onSelect} />
        ))}
        {!view.nobles.length && <p className="kh-muted">همهٔ اشراف دریافت شده‌اند.</p>}
      </div>
    </section>
  );
}
export function Marketplace({
  view,
  selected,
  onSelect,
}: {
  view: KahrobaView;
  selected: string | null;
  onSelect(c: DevelopmentCard): void;
}) {
  return (
    <section className="kh-market" aria-label="بازار کارت‌ها">
      {[3, 2, 1].map((tier) => (
        <div className={`kh-market-row kh-level-${tier}`} key={tier}>
          <span className="kh-tier">
            <span>سطح</span>
            <Num value={tier} />
          </span>
          <div className="kh-market-cards">
            {view.market[tier - 1]!.map((c, slot) =>
              c ? (
                <DevelopmentTile
                  key={c.id}
                  card={c}
                  selected={selected === c.id}
                  affordable={
                    view.kind === "PLAYER" &&
                    view.purchaseOptions.some((o) => o.cardId === c.id && o.affordable)
                  }
                  onSelect={onSelect}
                />
              ) : (
                <div key={`empty-${slot}`} className="kh-empty" aria-label="جای خالی کارت">
                  ◇
                </div>
              ),
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
export function GemBank({
  view,
  selection = [],
  onSelect,
  disabled = false,
}: {
  view: KahrobaView;
  selection?: TokenColor[];
  onSelect?(c: TokenColor): void;
  disabled?: boolean;
}) {
  return (
    <section className="kh-bank" aria-label="بانک ژتون‌ها" dir="ltr">
      {TOKEN_COLORS.map((c) => (
        <button
          key={c}
          disabled={disabled || !onSelect || c === "gold" || view.bank[c] === 0}
          aria-pressed={selection.includes(c)}
          aria-label={`${gemNames[c]}، موجودی ${view.bank[c]}`}
          onClick={() => onSelect?.(c)}
        >
          <Gem color={c} />
          <Num value={view.bank[c]} />
        </button>
      ))}
    </section>
  );
}
export function PlayerSummary({
  player,
  name,
  current,
  spectator,
  onReserved,
}: {
  player: PublicPlayer;
  name: string;
  current: boolean;
  spectator: boolean;
  onReserved(): void;
}) {
  return (
    <section className="kh-summary" aria-label="خلاصهٔ شما">
      <div className="kh-self">
        <img src={kahrobaAssets.noble("kahroba-noble-01")} alt="" width="56" height="56" />
        <div>
          <bdi dir="auto" className="kh-username">
            {name}
          </bdi>
          <span className="kh-self-status">
            {spectator ? "تماشاگر" : current ? "نوبت شما" : "نوبت حریف"}
          </span>
          <span className="kh-score">
            ★ <Num value={player.prestige} />
            <small>/ 15</small>
          </span>
        </div>
      </div>
      <div className="kh-summary-resources">
        <Resources values={player.bonuses} bonus gold={false} />
        <Resources values={player.tokens} />
      </div>
      {!spectator && (
        <button className="kh-reserved-link" onClick={onReserved}>
          کارت‌های رزرو <Num value={player.reservedCount} />
        </button>
      )}
    </section>
  );
}

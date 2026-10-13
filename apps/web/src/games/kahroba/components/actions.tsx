import { useState } from "react";
import {
  GEM_COLORS,
  TOKEN_COLORS,
  zeroTokens,
  type KahrobaPlayerView,
  type KahrobaCommand,
  type TokenVector,
  type DevelopmentCard,
  type KahrobaView,
} from "../adapters/index.js";
import { Gem, Num, DevelopmentTile, NobleTile, seatName, type PublicNames } from "./table.js";
import { gemNames } from "../assets.js";
import { KahrobaSheet } from "./sheet.js";
export function primaryKey(c: KahrobaCommand) {
  return JSON.stringify(
    c.type === "BUY_CARD"
      ? { type: c.type, source: c.source, cardId: c.cardId }
      : c.type === "TAKE_TOKENS"
        ? { type: c.type, selection: c.selection }
        : c.type === "RESERVE_CARD"
          ? { type: c.type, source: c.source }
          : { type: c.type },
  );
}
export function primaryGroups(view: KahrobaPlayerView, type: KahrobaCommand["type"]) {
  const groups = new Map<string, KahrobaCommand[]>();
  for (const c of view.legalCommands.filter((c) => c.type === type)) {
    const key = primaryKey(c);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()];
}
export function ActionBar({
  enabled,
  canCollect,
  canBuy,
  canReserve,
  onCollect,
  onBuy,
  onReserve,
}: {
  enabled: boolean;
  canCollect: boolean;
  canBuy: boolean;
  canReserve: boolean;
  onCollect(): void;
  onBuy(): void;
  onReserve(): void;
}) {
  return (
    <div className="kh-actionbar" aria-label="اقدام‌های بازی">
      <button className="collect" disabled={!enabled || !canCollect} onClick={onCollect}>
        <span aria-hidden="true">◇</span>گرفتن ژتون
      </button>
      <button className="reserve" disabled={!enabled || !canReserve} onClick={onReserve}>
        <span className="kh-back-symbol" aria-hidden="true">
          ▱
        </span>
        رزرو کارت
      </button>
      <button className="buy" disabled={!enabled || !canBuy} onClick={onBuy}>
        <span aria-hidden="true">＋</span>خرید کارت
      </button>
    </div>
  );
}
export function AffordableCardAssistant({
  view,
  onSelect,
  enabled,
}: {
  view: KahrobaView;
  onSelect(c: DevelopmentCard): void;
  enabled: boolean;
}) {
  const options = view.kind === "PLAYER" ? view.purchaseOptions.filter((o) => o.affordable) : [];
  const all = [
    ...view.market.flat().filter((c): c is DevelopmentCard => c !== null),
    ...(view.kind === "PLAYER" ? view.myReserved : []),
  ];
  const cards = all
    .filter((c) => options.some((o) => o.cardId === c.id))
    .sort((a, b) => b.tier - a.tier || (a.id < b.id ? -1 : 1));
  const [selected, setSelected] = useState<string | null>(null);
  const index = Math.max(
      0,
      cards.findIndex((c) => c.id === selected),
    ),
    card = cards[index];
  function move(offset: number) {
    if (cards.length) setSelected(cards[(index + offset + cards.length) % cards.length]!.id);
  }
  return (
    <section className="kh-assistant" aria-label="کارت‌های قابل خرید">
      <h2>کارت‌های قابل خرید</h2>
      {card ? (
        <div className="kh-assistant-body">
          <button
            className="kh-assistant-arrow"
            aria-label="کارت قابل خرید قبلی"
            disabled={cards.length < 2}
            onClick={() => move(-1)}
          >
            ‹
          </button>
          <DevelopmentTile card={card} compact affordable onSelect={onSelect} />
          <div className="kh-assistant-caption">
            <span>کاخ {gemNames[card.bonus]}</span>
            <small dir="ltr">
              <Num value={index + 1} /> / <Num value={cards.length} />
            </small>
            <button disabled={!enabled} onClick={() => onSelect(card)}>
              ✓ انتخاب خرید
            </button>
          </div>
          <button
            className="kh-assistant-arrow"
            aria-label="کارت قابل خرید بعدی"
            disabled={cards.length < 2}
            onClick={() => move(1)}
          >
            ›
          </button>
        </div>
      ) : (
        <p className="kh-muted">هنوز کارتی با منابع فعلی قابل خرید نیست.</p>
      )}
    </section>
  );
}
function TokenInputs({
  values,
  max,
  label,
  onChange,
}: {
  values: TokenVector;
  max: TokenVector;
  label: string;
  onChange(v: TokenVector): void;
}) {
  return (
    <div className="kh-token-inputs">
      {TOKEN_COLORS.map((c) => (
        <label key={c}>
          <Gem color={c} />
          <span>{gemNames[c]}</span>
          <input
            dir="ltr"
            type="number"
            inputMode="numeric"
            min="0"
            max={max[c]}
            step="1"
            aria-label={`${label} ${gemNames[c]}`}
            value={values[c]}
            onChange={(e) =>
              onChange({
                ...values,
                [c]: Math.max(0, Math.min(max[c], Number(e.target.value) || 0)),
              })
            }
          />
        </label>
      ))}
    </div>
  );
}
export function TurnConfirmation({
  view,
  choices,
  onClose,
  onConfirm,
  disabled,
}: {
  view: KahrobaPlayerView;
  choices: KahrobaCommand[];
  onClose(): void;
  onConfirm(c: KahrobaCommand): void;
  disabled: boolean;
}) {
  const base = choices[0]!,
    owner = view.players.find((p) => p.id === view.viewerId)!;
  const [payment, setPayment] = useState<TokenVector>(() =>
    base.type === "BUY_CARD" ? { ...base.payment } : zeroTokens(),
  );
  const [returned, setReturned] = useState<TokenVector>(() =>
    "returnTokens" in base ? { ...(base.returnTokens ?? zeroTokens()) } : zeroTokens(),
  );
  const nobleIds = [...new Set(choices.flatMap((c) => (c.nobleId ? [c.nobleId] : [])))];
  const [noble, setNoble] = useState<string | null>(() =>
    nobleIds.length === 1 ? nobleIds[0]! : null,
  );
  const option =
    base.type === "BUY_CARD"
      ? view.purchaseOptions.find((o) => o.cardId === base.cardId && o.source === base.source)
      : undefined;
  const card =
    base.type === "BUY_CARD" || (base.type === "RESERVE_CARD" && base.source.kind === "MARKET")
      ? [...view.market.flat(), ...view.myReserved].find(
          (c) =>
            c?.id ===
            (base.type === "BUY_CARD"
              ? base.cardId
              : base.type === "RESERVE_CARD" && base.source.kind === "MARKET"
                ? base.source.cardId
                : null),
        )
      : null;
  const sum = (v: TokenVector) => TOKEN_COLORS.reduce((s, c) => s + v[c], 0);
  const returnTotal = "returnTokens" in base ? sum(base.returnTokens ?? zeroTokens()) : 0;
  const maxReturns = { ...owner.tokens };
  if (base.type === "TAKE_TOKENS")
    for (const c of GEM_COLORS)
      maxReturns[c] +=
        base.selection.mode === "DOUBLE"
          ? base.selection.color === c
            ? 2
            : 0
          : base.selection.colors.includes(c)
            ? 1
            : 0;
  if (base.type === "RESERVE_CARD" && view.bank.gold > 0) maxReturns.gold++;
  const paymentValid =
    base.type !== "BUY_CARD" ||
    (option?.affordable === true &&
      GEM_COLORS.every(
        (c) => payment[c] <= option.effectiveCost[c] && payment[c] <= owner.tokens[c],
      ) &&
      payment.gold <= owner.tokens.gold &&
      payment.gold ===
        GEM_COLORS.reduce((sum, c) => sum + option.effectiveCost[c] - payment[c], 0));
  const returnsValid =
    sum(returned) === returnTotal && TOKEN_COLORS.every((c) => returned[c] <= maxReturns[c]);
  const nobleValid = nobleIds.length < 2 || noble !== null;
  const title =
    base.type === "BUY_CARD"
      ? "تأیید خرید کارت"
      : base.type === "RESERVE_CARD"
        ? "تأیید رزرو کارت"
        : base.type === "PASS"
          ? "عبور اجباری"
          : "تأیید گرفتن ژتون";
  function confirm() {
    if (disabled || !paymentValid || !returnsValid || !nobleValid) return;
    const command = {
      ...base,
      ...(base.type === "BUY_CARD" ? { payment } : {}),
      ...(returnTotal ? { returnTokens: returned } : {}),
      ...(noble ? { nobleId: noble } : {}),
    };
    onConfirm(command);
  }
  return (
    <KahrobaSheet title={title} onClose={onClose}>
      {card && (
        <div className="kh-confirm-card">
          <DevelopmentTile card={card} />
        </div>
      )}
      {base.type === "RESERVE_CARD" && base.source.kind === "DECK" && (
        <div className="kh-cardback">
          ◇
          <p>
            رزرو پنهان سطح <Num value={base.source.tier} />
          </p>
        </div>
      )}
      {base.type === "TAKE_TOKENS" && (
        <p>
          ژتون‌های انتخابی:{" "}
          {base.selection.mode === "DOUBLE"
            ? `${gemNames[base.selection.color]} × 2`
            : base.selection.colors.map((c) => gemNames[c]).join("، ")}
        </p>
      )}
      {base.type === "PASS" && <p>هیچ اقدام اصلی در این نوبت در دسترس نیست.</p>}
      {base.type === "BUY_CARD" && option && (
        <>
          <h3>انتخاب پرداخت</h3>
          <p className="kh-muted">هزینه پس از تخفیف کارت‌ها؛ طلا می‌تواند جای هر رنگ را بگیرد.</p>
          <div className="kh-effective" dir="ltr">
            {GEM_COLORS.filter((c) => option.effectiveCost[c] > 0).map((c) => (
              <span key={c}>
                <Gem color={c} />
                <Num value={option.effectiveCost[c]} />
              </span>
            ))}
          </div>
          <TokenInputs values={payment} max={owner.tokens} label="پرداخت" onChange={setPayment} />
          {!paymentValid && <p role="status">پرداخت باید دقیقاً برابر هزینهٔ باقی‌مانده باشد.</p>}
        </>
      )}
      {returnTotal > 0 && (
        <>
          <h3>
            بازگرداندن <Num value={returnTotal} /> ژتون
          </h3>
          <p>انتخاب کن تا بیش از 10 ژتون نگه نداری.</p>
          <TokenInputs
            values={returned}
            max={maxReturns}
            label="بازگرداندن"
            onChange={setReturned}
          />
          {!returnsValid && (
            <p role="status">
              دقیقاً <Num value={returnTotal} /> ژتون انتخاب کن.
            </p>
          )}
        </>
      )}
      {nobleIds.length > 0 && (
        <>
          <h3>{nobleIds.length > 1 ? "انتخاب اشراف" : "اشراف این نوبت"}</h3>
          <div className="kh-noble-choices">
            {view.nobles
              .filter((n) => nobleIds.includes(n.id))
              .map((n) => (
                <label key={n.id}>
                  <input
                    type="radio"
                    name="noble"
                    aria-label={`انتخاب اشراف ${n.id}`}
                    checked={noble === n.id}
                    onChange={() => setNoble(n.id)}
                  />
                  <NobleTile noble={n} onSelect={() => setNoble(n.id)} />
                </label>
              ))}
          </div>
        </>
      )}
      <button
        className="kh-confirm"
        disabled={disabled || !paymentValid || !returnsValid || !nobleValid}
        onClick={confirm}
      >
        تأیید اقدام
      </button>
    </KahrobaSheet>
  );
}
export function ResultSheet({
  view,
  names,
  onClose,
}: {
  view: KahrobaView;
  names: PublicNames;
  onClose(): void;
}) {
  const r = view.result;
  if (!r) return null;
  return (
    <KahrobaSheet
      title={r.winnerIds.length > 1 ? "پیروزی مشترک" : "نتیجهٔ کهربا"}
      onClose={onClose}
    >
      <div className="kh-result-crown" aria-hidden="true">
        ♛
      </div>
      <p className="kh-winners">{r.winnerIds.map((id) => seatName(id, view, names)).join(" و ")}</p>
      <p className="kh-muted">امتیاز برابر: کارت‌های خریداری‌شدهٔ کمتر رتبهٔ بهتر دارد.</p>
      <table className="kh-results">
        <thead>
          <tr>
            <th>رتبه</th>
            <th>بازیکن</th>
            <th>امتیاز</th>
            <th>کارت خریداری‌شده</th>
          </tr>
        </thead>
        <tbody>
          {r.scores.map((s) => (
            <tr key={s.playerId} className={r.winnerIds.includes(s.playerId) ? "winner" : ""}>
              <td>
                <Num value={s.place} />
              </td>
              <td>
                <bdi dir="auto">{seatName(s.playerId, view, names)}</bdi>
              </td>
              <td>
                <Num value={s.prestige} />
              </td>
              <td>
                <Num value={s.purchasedCards} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="kh-confirm" onClick={onClose}>
        بازگشت به میز
      </button>
    </KahrobaSheet>
  );
}

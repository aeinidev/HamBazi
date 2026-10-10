import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../../../platform/contracts.js";
import { matchAckSchema, okValue } from "../../../platform/contracts.js";
import { ClientError } from "../../../platform/errors.js";
import { useRuntime, useSession, useTask } from "../../../ui/shared.js";
import { MidnightIcon } from "../../../ui/midnight.js";
import { toCoupView, type CoupCommand, type CoupView, type CoupRole } from "../adapters/index.js";
import { Table, actionNames, persianNumber, seatName } from "../components/index.js";
import { InfluenceCard, CoinIcon, roleNames, roleInfo } from "../components/cards.js";
import { TableSheet } from "../components/sheet.js";
import { useExchangeSelection } from "../store/index.js";
import "./table.css";
type ActionType = Extract<CoupCommand, { type: `DECLARE_${string}` }>["type"];
const primary: ActionType[] = [
  "DECLARE_INCOME",
  "DECLARE_FOREIGN_AID",
  "DECLARE_TAX",
  "DECLARE_COUP",
];
const secondary: ActionType[] = ["DECLARE_STEAL", "DECLARE_ASSASSINATION", "DECLARE_EXCHANGE"];
const receivedDefenses = new WeakMap<object, Set<string>>();
export function CoupMatch({
  snapshot,
  onEnd,
  endBlocked = false,
}: {
  snapshot: Snapshot;
  onEnd?: (() => void) | undefined;
  endBlocked?: boolean;
}) {
  const session = useSession((s) => s.session),
    connection = useSession((s) => s.connection),
    resyncNeeded = useSession((s) => s.resyncNeeded);
  const view = session ? toCoupView(snapshot, session.userId) : null;
  if (!view)
    return (
      <div className="notice error" role="alert">
        این بازی به نسخهٔ جدیدتری از برنامه نیاز دارد.
      </div>
    );
  return (
    <CoupContent
      key={`${snapshot.matchId}:${view.kind}`}
      snapshot={snapshot}
      view={view}
      available={connection === "connected" && !resyncNeeded}
      onEnd={onEnd}
      endBlocked={endBlocked}
    />
  );
}
function commandLabel(c: CoupCommand, view: CoupView) {
  switch (c.type) {
    case "PASS_CHALLENGE":
      return "پذیرش ادعا";
    case "PASS_BLOCK":
      return "بدون مسدودسازی";
    case "CHALLENGE":
      return "چالش ادعا";
    case "CONCEDE_CLAIM":
      return "انصراف از ادعا";
    case "BLOCK":
      return `مسدودسازی با ${roleNames[c.role]}`;
    case "PROVE_CLAIM":
      return view.kind === "PLAYER" ? `اثبات با ${roleNames[view.myCards[c.cardIndex]!]}` : "اثبات";
    case "SELECT_CARD_TO_LOSE":
      return view.kind === "PLAYER"
        ? `از دست دادن ${roleNames[view.myCards[c.cardIndex]!]}`
        : "انتخاب نفوذ";
    default:
      return "تأیید";
  }
}
function actionDescription(type: ActionType, view: CoupView) {
  if (!("actionRules" in view)) return "قوانین بازی فعلی";
  const r = view.actionRules;
  switch (type) {
    case "DECLARE_INCOME":
      return `دریافت ${persianNumber(r.incomeCoins)} سکه`;
    case "DECLARE_FOREIGN_AID":
      return `دریافت ${persianNumber(r.foreignAidCoins)} سکه`;
    case "DECLARE_TAX":
      return `دریافت ${persianNumber(r.taxCoins)} سکه · بزرگ‌زاده`;
    case "DECLARE_COUP":
      return `پرداخت ${persianNumber(r.coupCost)} سکه`;
    case "DECLARE_STEAL":
      return `دریافت تا ${persianNumber(r.stealCoins)} سکه · کاپیتان`;
    case "DECLARE_ASSASSINATION":
      return `پرداخت ${persianNumber(r.assassinationCost)} سکه · آدمکش`;
    case "DECLARE_EXCHANGE":
      return "تعویض کارت · سفیر";
    case "DECLARE_ANARCHIST":
      return "پرداخت ۵ سکه";
  }
}
function CoupContent({
  snapshot,
  view,
  available,
  onEnd,
  endBlocked,
}: {
  snapshot: Snapshot;
  view: CoupView;
  available: boolean;
  onEnd?: (() => void) | undefined;
  endBlocked: boolean;
}) {
  const runtime = useRuntime(),
    task = useTask("fa"),
    commands = view.kind === "PLAYER" ? view.legalCommands : [];
  const exchange = useExchangeSelection(view.revision, commands);
  const [sheet, setSheet] = useState<"actions" | "exchange" | null>(null),
    [detail, setDetail] = useState<CoupRole | null>(null),
    [targetAction, setTargetAction] = useState<ActionType | null>(null),
    [selectedTarget, setSelectedTarget] = useState<CoupCommand | null>(null),
    [defending, setDefending] = useState<string | null>(null);
  const defenseTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    defense = "lastDefense" in view ? view.lastDefense : null;
  useEffect(() => {
    if (
      !defense ||
      Date.now() - defense.occurredAt > 10000 ||
      defense.occurredAt > Date.now() + 1000
    )
      return;
    const seen = receivedDefenses.get(runtime) ?? new Set<string>();
    receivedDefenses.set(runtime, seen);
    const key = `${snapshot.matchId}:${defense.revision}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 64) seen.delete(seen.values().next().value!);
    setDefending(defense.targetId);
    if (defenseTimer.current) clearTimeout(defenseTimer.current);
    defenseTimer.current = setTimeout(() => setDefending(null), 2000);
  }, [runtime, snapshot.matchId, defense?.revision]);
  useEffect(
    () => () => {
      if (defenseTimer.current) clearTimeout(defenseTimer.current);
    },
    [],
  );
  useEffect(() => {
    setSelectedTarget(null);
    setTargetAction(null);
    setSheet(null);
  }, [view.revision]);
  const canAct =
    available && snapshot.status === "ACTIVE" && view.kind === "PLAYER" && !task.blocked;
  function send(command: CoupCommand) {
    if (!canAct) return;
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
  const own = view.kind === "PLAYER" ? view.players.find((p) => p.id === view.viewerId) : null,
    personal = runtime.scope === "owner-auth";
  function choose(type: ActionType) {
    const choices = commands.filter((c) => c.type === type);
    if (!canAct || !choices.length) return;
    if ("targetId" in choices[0]!) {
      setSheet(null);
      setTargetAction(type);
      setSelectedTarget(null);
    } else send(choices[0]!);
  }
  function actionButton(type: ActionType) {
    return (
      <button
        key={type}
        className={`table-action ${type === "DECLARE_INCOME" ? "important" : ""}`}
        disabled={!canAct || !commands.some((c) => c.type === type)}
        onClick={() => choose(type)}
      >
        <span>{actionNames[type.slice(8) as keyof typeof actionNames]}</span>
        <small>{actionDescription(type, view)}</small>
      </button>
    );
  }
  const anarchistSupported = view.stateSchemaVersion === 5,
    affordable = (own?.coins ?? 0) >= 5;
  const confirmedTarget = selectedTarget
    ? commands.find((c) => JSON.stringify(c) === JSON.stringify(selectedTarget))
    : null;
  return (
    <section className="coup-gameplay" dir="rtl" aria-label="میز کودتا" aria-busy={task.pending}>
      <Table view={view} personal={personal} defending={defending} />
      {!available && (
        <p className="table-notice" role="status">
          در حال اتصال و همگام‌سازی میز…
        </p>
      )}
      {view.kind === "SPECTATOR" && (
        <p className="table-notice">تماشاگر هستی؛ کنترل‌های بازیکن در دسترس نیست.</p>
      )}
      {view.kind === "PLAYER" && (
        <section className="local-hand" aria-label="کارت‌های شما">
          <div className="local-influences">
            {view.myCards.map((role, i) => (
              <InfluenceCard key={i} role={role} detail={() => setDetail(role)} />
            ))}
          </div>
          {anarchistSupported && (
            <div className={`shared-anarchist ${affordable ? "affordable" : "locked"}`}>
              <button
                className="anarchist-shortcut"
                disabled={!canAct || !commands.some((c) => c.type === "DECLARE_ANARCHIST")}
                aria-label="آنارشیست، پرداخت ۵ سکه"
                onClick={() => choose("DECLARE_ANARCHIST")}
              >
                <img
                  src="/assets/coup/anarchist.png"
                  alt=""
                  width="1024"
                  height="1536"
                  draggable={false}
                />
                <span>آنارشیست</span>
                {!affordable && <MidnightIcon name="lock" />}
              </button>
              <small>
                <CoinIcon />۵ سکه
              </small>
            </div>
          )}
          <span className="local-coins" role="group" aria-label="سکه‌های شما">
            <CoinIcon />
            {persianNumber(own?.coins ?? 0)}
          </span>
          {defending === view.viewerId && (
            <div className="local-defense" role="status">
              <InfluenceCard role="CONTESSA" />
              <span>دفاع شاه‌دخت · تعویض کارت</span>
            </div>
          )}
        </section>
      )}
      {view.kind === "PLAYER" && snapshot.status === "ACTIVE" && (
        <section className="table-controls" aria-label="اقدام‌های بازی">
          {view.phase === "WAITING_FOR_ACTION" ? (
            <>
              <div className="primary-actions">{primary.map(actionButton)}</div>
              <button
                className="more-actions"
                onClick={() => setSheet("actions")}
                disabled={task.pending}
              >
                سایر اقدام‌ها · سرقت، آدمکشی، تعویض
              </button>
            </>
          ) : (
            <div className="reaction-actions">
              {commands
                .filter((c) => "windowId" in c && c.type !== "SELECT_EXCHANGE")
                .map((c, i) => (
                  <button key={i} disabled={!canAct} onClick={() => send(c)}>
                    {commandLabel(c, view)}
                  </button>
                ))}
              {view.exchangeChoices && (
                <button disabled={!canAct} onClick={() => setSheet("exchange")}>
                  انتخاب کارت‌های تعویض
                </button>
              )}
              {!commands.length && <p role="status">منتظر پاسخ بازیکن دیگر</p>}
            </div>
          )}
          {task.notice}
        </section>
      )}
      {sheet === "actions" && (
        <TableSheet title="سایر اقدام‌ها" onClose={() => setSheet(null)}>
          <div className="secondary-actions">
            {secondary.map(actionButton)}
            {onEnd && (
              <button disabled={endBlocked || task.pending} onClick={onEnd}>
                پایان بازی
              </button>
            )}
          </div>
        </TableSheet>
      )}
      {sheet === "exchange" && view.kind === "PLAYER" && view.exchangeChoices && (
        <TableSheet title="انتخاب کارت‌های نگه‌داشتنی" onClose={() => setSheet(null)}>
          <p>به تعداد نفوذ زندهٔ خودت کارت انتخاب کن.</p>
          <div className="exchange-options">
            {view.exchangeChoices.map((role, i) => (
              <label key={i}>
                <input
                  type="checkbox"
                  aria-label={`کارت ${persianNumber(i + 1)}: ${roleNames[role]}`}
                  checked={exchange.indices.includes(i)}
                  disabled={!canAct}
                  onChange={() => exchange.toggle(i)}
                />
                <InfluenceCard role={role} />
              </label>
            ))}
          </div>
          <button
            disabled={!canAct || !exchange.selected}
            onClick={() => {
              if (exchange.selected) send(exchange.selected);
            }}
          >
            نگه داشتن کارت‌های انتخاب‌شده
          </button>
        </TableSheet>
      )}
      {targetAction && (
        <TableSheet
          title={`انتخاب هدف ${actionNames[targetAction.slice(8) as keyof typeof actionNames]}`}
          onClose={() => {
            setTargetAction(null);
            setSelectedTarget(null);
          }}
        >
          <p>بازیکن هدف را انتخاب و تأیید کن.</p>
          <div className="target-options">
            {commands
              .filter((c) => c.type === targetAction && "targetId" in c)
              .map((c, i) => (
                <button
                  key={i}
                  disabled={!canAct}
                  aria-pressed={
                    !!selectedTarget && JSON.stringify(selectedTarget) === JSON.stringify(c)
                  }
                  onClick={() => setSelectedTarget(c)}
                >
                  {"targetId" in c && seatName(view, c.targetId, personal)}
                </button>
              ))}
          </div>
          <button
            className="confirm-target"
            disabled={!canAct || !confirmedTarget}
            onClick={() => {
              if (confirmedTarget) send(confirmedTarget);
            }}
          >
            تأیید هدف و اقدام
          </button>
        </TableSheet>
      )}
      {detail && (
        <TableSheet title={`اطلاعات ${roleNames[detail]}`} onClose={() => setDetail(null)}>
          <InfluenceCard role={detail} />
          <p>{roleInfo[detail]}</p>
          {detail === "CONTESSA" && !anarchistSupported && (
            <p>آنارشیست در این بازیِ قبلی فعال نیست.</p>
          )}
        </TableSheet>
      )}
    </section>
  );
}

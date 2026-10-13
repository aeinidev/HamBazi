import { useEffect, useState } from "react";
import { useRuntime, useSession, ErrorNotice } from "../../../ui/shared.js";
import { profileSchema, type Snapshot } from "../../../platform/contracts.js";
import { ClientError } from "../../../platform/errors.js";
import { useQuery } from "@tanstack/react-query";
import {
  toKahrobaView,
  type DevelopmentCard,
  type Noble,
  type KahrobaCommand,
  type TokenColor,
} from "../adapters/index.js";
import { useKahrobaCommands } from "../store/index.js";
import { kahrobaAssets, gemNames } from "../assets.js";
import {
  Marketplace,
  NobleRail,
  PlayerStrip,
  PlayerSummary,
  GemBank,
  DevelopmentTile,
  NobleTile,
  Num,
  seatName,
  type PublicNames,
} from "../components/table.js";
import {
  AffordableCardAssistant,
  ActionBar,
  TurnConfirmation,
  primaryGroups,
  primaryKey,
  ResultSheet,
} from "../components/actions.js";
import { KahrobaSheet } from "../components/sheet.js";
import "./table.css";

export function KahrobaSession({
  id,
  names = {},
  onBack,
}: {
  id: string;
  names?: PublicNames;
  onBack?(): void;
}) {
  const runtime = useRuntime(),
    connection = useSession((s) => s.connection);
  useEffect(() => {
    if (connection === "connected")
      void runtime
        .realtime()
        .subscribe(id)
        .catch((error) =>
          runtime.store.setState({
            realtimeError: error instanceof ClientError ? error : new ClientError("INTERNAL_ERROR"),
          }),
        );
  }, [runtime, id, connection]);
  return <KahrobaMatch matchId={id} names={names} onBack={onBack} />;
}
export function KahrobaMatch({
  matchId,
  names = {},
  onBack,
}: {
  matchId: string;
  names?: PublicNames;
  onBack?: (() => void) | undefined;
}) {
  const runtime = useRuntime(),
    session = useSession((s) => s.session),
    raw = useSession((s) => s.snapshot),
    connection = useSession((s) => s.connection),
    resync = useSession((s) => s.resyncNeeded);
  const transportError = useSession((s) => s.realtimeError);
  const snapshot: Snapshot | null = raw?.matchId === matchId ? raw : null;
  const view = session && snapshot ? toKahrobaView(snapshot, session.userId) : null;
  const task = useKahrobaCommands(runtime, matchId, snapshot);
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: ({ signal }) => runtime.http("/v1/me", profileSchema, undefined, "GET", true, signal),
    enabled: !!session,
  });
  const [selected, setSelected] = useState<DevelopmentCard | null>(null),
    [nobleDetail, setNobleDetail] = useState<Noble | null>(null),
    [sheet, setSheet] = useState<"collect" | "reserve" | "reserved" | "menu" | null>(null),
    [choices, setChoices] = useState<KahrobaCommand[] | null>(null),
    [colors, setColors] = useState<TokenColor[]>([]),
    [mode, setMode] = useState<"DISTINCT" | "DOUBLE">("DISTINCT"),
    [dismissed, setDismissed] = useState<number | null>(null);
  useEffect(() => {
    setSelected(null);
    setNobleDetail(null);
    setSheet(null);
    setChoices(null);
    setColors([]);
  }, [snapshot?.stateVersion, snapshot?.role]);
  const available = connection === "connected" && !resync;
  const player = view?.players.find((p) => p.id === session?.userId);
  const canAct = !!(
    available &&
    snapshot?.status === "ACTIVE" &&
    view?.kind === "PLAYER" &&
    view.turnPlayerId === view.viewerId &&
    !task.blocked
  );
  const handles = {
    ...names,
    ...(session && profile.data ? { [session.userId]: profile.data.publicHandle } : {}),
  };
  const playerView = view?.kind === "PLAYER" ? view : null;
  const groups = playerView
    ? {
        collect: primaryGroups(playerView, "TAKE_TOKENS"),
        buy: primaryGroups(playerView, "BUY_CARD"),
        reserve: primaryGroups(playerView, "RESERVE_CARD"),
        pass: primaryGroups(playerView, "PASS"),
      }
    : null;
  const selectedCurrent =
    selected && view
      ? ([...view.market.flat(), ...(playerView?.myReserved ?? [])].find(
          (c) => c?.id === selected.id,
        ) ?? null)
      : null;
  const buy = selectedCurrent
    ? groups?.buy.find((g) => g[0]?.type === "BUY_CARD" && g[0].cardId === selectedCurrent.id)
    : undefined;
  const reserve = selectedCurrent
    ? groups?.reserve.find(
        (g) =>
          g[0]?.type === "RESERVE_CARD" &&
          g[0].source.kind === "MARKET" &&
          g[0].source.cardId === selectedCurrent.id,
      )
    : undefined;
  const collection = groups?.collect.find((g) => {
    const c = g[0];
    return (
      c?.type === "TAKE_TOKENS" &&
      (c.selection.mode === "DOUBLE"
        ? mode === "DOUBLE" && colors.length === 1 && colors[0] === c.selection.color
        : mode === "DISTINCT" &&
          colors.length === c.selection.colors.length &&
          colors.every(
            (color) =>
              c.selection.mode === "DISTINCT" &&
              c.selection.colors.includes(color as (typeof c.selection.colors)[number]),
          ))
    );
  });
  function token(color: TokenColor) {
    setSheet("collect");
    setColors((current) =>
      mode === "DOUBLE"
        ? [color]
        : current.includes(color)
          ? current.filter((c) => c !== color)
          : [...current.slice(-2), color],
    );
  }
  function confirmGroup(group: KahrobaCommand[]) {
    if (!canAct) return;
    setSheet(null);
    setSelected(null);
    setChoices(group);
  }
  return (
    <section
      className="kh-game"
      dir="rtl"
      aria-label="میز کهربا"
      aria-busy={task.pending}
      data-state-version={snapshot?.stateVersion}
    >
      <header className="kh-header">
        <button
          className="kh-icon-button"
          aria-label="بازگشت"
          onClick={
            onBack ??
            (() => {
              location.hash = "/games";
            })
          }
        >
          ‹
        </button>
        <img className="kh-logo" src={kahrobaAssets.logo} alt="کهربا" width="320" height="213" />
        <button className="kh-icon-button" aria-label="منوی کهربا" onClick={() => setSheet("menu")}>
          ☰
        </button>
      </header>
      {!available && (
        <div className="kh-connection" role="status">
          در حال اتصال و همگام‌سازی…{" "}
          <button onClick={() => runtime.realtime().retry()}>اتصال دوباره</button>
        </div>
      )}
      {snapshot && !view && (
        <p className="kh-notice" role="alert">
          اطلاعات این میز با نسخهٔ برنامه سازگار نیست.
        </p>
      )}
      {!snapshot && available && (
        <p className="kh-notice" role="status">
          در حال دریافت میز…
        </p>
      )}
      {view && session && (
        <>
          <PlayerStrip view={view} viewerId={session.userId} names={handles} />
          <NobleRail view={view} onSelect={setNobleDetail} />
          <Marketplace view={view} selected={selectedCurrent?.id ?? null} onSelect={setSelected} />
          <GemBank view={view} selection={colors} disabled={!canAct} onSelect={token} />
          {view.kind === "PLAYER" && (
            <AffordableCardAssistant view={view} onSelect={setSelected} enabled={canAct} />
          )}
          {view.kind === "PLAYER" && (
            <ActionBar
              enabled={canAct}
              canCollect={!!groups?.collect.length}
              canBuy={!!groups?.buy.length}
              canReserve={!!groups?.reserve.length}
              onCollect={() => {
                setSheet("collect");
                setColors([]);
              }}
              onBuy={() => {
                if (selectedCurrent) setSelected(selectedCurrent);
                else {
                  const g = groups?.buy[0];
                  if (g) confirmGroup(g);
                }
              }}
              onReserve={() => setSheet("reserve")}
            />
          )}
          {groups?.pass.length === 1 && (
            <button
              className="kh-confirm"
              disabled={!canAct}
              onClick={() => confirmGroup(groups.pass[0]!)}
            >
              عبور اجباری
            </button>
          )}
          {player && (
            <PlayerSummary
              player={player}
              name={handles[player.id] ?? seatName(player.id, view, handles)}
              current={view.turnPlayerId === player.id}
              spectator={view.kind === "SPECTATOR"}
              onReserved={() => setSheet("reserved")}
            />
          )}
          {view.kind === "SPECTATOR" && (
            <p className="kh-notice">تماشاگر هستی؛ اطلاعات خصوصی بازیکنان نمایش داده نمی‌شود.</p>
          )}
          {view.finalRound && view.phase !== "GAME_OVER" && (
            <p className="kh-final-round" role="status">
              دور پایانی · نوبت‌های باقی‌مانده تا پایان دور ادامه دارند.
            </p>
          )}
          {view.result && (
            <button className="kh-confirm" onClick={() => setDismissed(null)}>
              مشاهدهٔ نتیجه
            </button>
          )}
        </>
      )}
      {task.error !== null && (
        <ErrorNotice
          error={task.error}
          language="fa"
          {...(task.blocked ? { retry: task.retry } : {})}
        />
      )}
      {transportError && (!snapshot || view) && (
        <ErrorNotice
          error={transportError}
          language="fa"
          retry={() => runtime.realtime().retry()}
        />
      )}
      {sheet === "menu" && (
        <KahrobaSheet title="کهربا" onClose={() => setSheet(null)}>
          <p>با جمع‌آوری جواهر، خرید کاخ‌ها و دریافت اشراف به 15 امتیاز برس.</p>
          <p>
            هر کارت، یک تخفیف دائمی از رنگ خودش می‌دهد. اشراف با تعداد کارت‌های رنگی دریافت می‌شوند.
          </p>
          <p>حداکثر 10 ژتون و 3 کارت رزرو می‌توان نگه داشت.</p>
          <button className="kh-confirm" onClick={() => setSheet(null)}>
            ادامهٔ بازی
          </button>
        </KahrobaSheet>
      )}
      {view && nobleDetail && (
        <KahrobaSheet title="نیازمندی‌های اشراف" onClose={() => setNobleDetail(null)}>
          <NobleTile noble={nobleDetail} />
          <p>نمادهای کارت، پاداش دائمی کارت‌های خریداری‌شده‌اند؛ ژتون خرج نمی‌شود.</p>
        </KahrobaSheet>
      )}
      {view && selectedCurrent && !choices && (
        <KahrobaSheet title="جزئیات کارت" onClose={() => setSelected(null)}>
          <div className="kh-confirm-card">
            <DevelopmentTile card={selectedCurrent} />
          </div>
          <p>
            سطح <Num value={selectedCurrent.tier} /> · امتیاز{" "}
            <Num value={selectedCurrent.prestige} />
          </p>
          <div className="kh-detail-actions">
            <button
              disabled={!canAct || !buy}
              onClick={() => {
                if (buy) confirmGroup(buy);
              }}
            >
              خرید این کارت
            </button>
            <button
              disabled={!canAct || !reserve}
              onClick={() => {
                if (reserve) confirmGroup(reserve);
              }}
            >
              رزرو این کارت
            </button>
          </div>
          {!buy && <p className="kh-muted">خرید این کارت در نوبت فعلی در دسترس نیست.</p>}
        </KahrobaSheet>
      )}
      {sheet === "collect" && view && playerView && (
        <KahrobaSheet title="انتخاب ژتون‌ها" onClose={() => setSheet(null)}>
          <div className="kh-segment">
            <button
              aria-pressed={mode === "DISTINCT"}
              onClick={() => {
                setMode("DISTINCT");
                setColors([]);
              }}
            >
              رنگ‌های متفاوت
            </button>
            <button
              aria-pressed={mode === "DOUBLE"}
              disabled={
                !groups?.collect.some(
                  (g) => g[0]?.type === "TAKE_TOKENS" && g[0].selection.mode === "DOUBLE",
                )
              }
              onClick={() => {
                setMode("DOUBLE");
                setColors([]);
              }}
            >
              دو ژتون هم‌رنگ
            </button>
          </div>
          <GemBank view={view} selection={colors} onSelect={token} disabled={!canAct} />
          <p className="kh-muted">انتخاب ژتون‌ها تا زمان تأیید، فقط انتخاب است.</p>
          {groups?.collect
            .filter((g) => g[0]?.type === "TAKE_TOKENS" && g[0].selection.mode === mode)
            .map((g) => {
              const c = g[0]!;
              if (c.type !== "TAKE_TOKENS") return null;
              return (
                <button
                  className="kh-collection-choice"
                  key={primaryKey(c)}
                  aria-pressed={collection === g}
                  onClick={() =>
                    setColors(
                      c.selection.mode === "DOUBLE" ? [c.selection.color] : [...c.selection.colors],
                    )
                  }
                >
                  {c.selection.mode === "DOUBLE"
                    ? `${gemNames[c.selection.color]} × 2`
                    : c.selection.colors.map((color) => gemNames[color]).join(" · ")}
                </button>
              );
            })}
          <button
            className="kh-confirm"
            disabled={!canAct || !collection}
            onClick={() => {
              if (collection) confirmGroup(collection);
            }}
          >
            ادامه و تأیید ژتون‌ها
          </button>
        </KahrobaSheet>
      )}
      {sheet === "reserve" && view && playerView && (
        <KahrobaSheet title="رزرو کارت" onClose={() => setSheet(null)}>
          <p>کارت بازار را لمس کن یا از یک دسته، پنهانی رزرو کن.</p>
          <div className="kh-decks">
            {[3, 2, 1].map((tier) => {
              const group = groups?.reserve.find(
                (g) =>
                  g[0]?.type === "RESERVE_CARD" &&
                  g[0].source.kind === "DECK" &&
                  g[0].source.tier === tier,
              );
              return (
                <button
                  key={tier}
                  className="kh-cardback"
                  disabled={!canAct || !group}
                  onClick={() => {
                    if (group) confirmGroup(group);
                  }}
                >
                  ◇
                  <span>
                    سطح <Num value={tier} />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="kh-reserve-market">
            {view.market
              .flat()
              .filter((c): c is DevelopmentCard => c !== null)
              .map((c) => (
                <DevelopmentTile
                  key={c.id}
                  card={c}
                  onSelect={() => {
                    setSheet(null);
                    setSelected(c);
                  }}
                />
              ))}
          </div>
        </KahrobaSheet>
      )}
      {sheet === "reserved" && playerView && (
        <KahrobaSheet title="کارت‌های رزرو شما" onClose={() => setSheet(null)}>
          <p className="kh-muted">این کارت‌ها فقط برای شما قابل مشاهده‌اند.</p>
          <div className="kh-reserved-grid">
            {playerView.myReserved.map((c) => (
              <DevelopmentTile
                key={c.id}
                card={c}
                onSelect={() => {
                  setSheet(null);
                  setSelected(c);
                }}
              />
            ))}
          </div>
          {!playerView.myReserved.length && <p>هنوز کارتی رزرو نکرده‌ای.</p>}
        </KahrobaSheet>
      )}
      {playerView && choices && snapshot && (
        <TurnConfirmation
          key={`${snapshot.stateVersion}:${primaryKey(choices[0]!)}`}
          view={playerView}
          choices={choices}
          disabled={!canAct}
          onClose={() => setChoices(null)}
          onConfirm={(c) => {
            task.send(c);
            setChoices(null);
          }}
        />
      )}
      {view?.result && view.revision !== dismissed && (
        <ResultSheet view={view} names={handles} onClose={() => setDismissed(view.revision)} />
      )}
    </section>
  );
}

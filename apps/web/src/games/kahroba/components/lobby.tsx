import { useState } from "react";
import { PalaceIcon } from "./palace-icon.js";
import { PalaceGem } from "./palace-gem.js";
import { usePalacePreferences } from "../palace-preferences.js";
import { KahrobaSheet } from "./sheet.js";
import type { Connection } from "../../../platform/realtime.js";
import { AccountAvatar, MidnightIcon } from "../../../ui/midnight.js";
import { kahrobaAssets } from "../assets.js";
import type { KahrobaLobbyInvite, KahrobaLobbyRoom } from "../lobby-invitation.js";
import "./lobby.css";
import { useFittedPageScroll } from "../../../ui/fitted-page-scroll.js";

export function LobbyIcon({
  name,
}: {
  name: "share" | "plus" | "help" | "crown" | "copy" | "more" | "chevron" | "wifi" | "game";
}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="khl-icon" aria-hidden="true">
      {name === "share" ? (
        <>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.5 10.5 7-4M8.5 13.5l7 4" />
        </>
      ) : name === "plus" ? (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v12M6 12h12" />
        </>
      ) : name === "help" ? (
        <>
          <path d="M8 8a4 4 0 1 1 6 3.5c-2 1-2 2-2 3M12 18v1" />
        </>
      ) : name === "crown" ? (
        <path d="m3 6 4 5 5-8 5 8 4-5-2 13H5Z" />
      ) : name === "copy" ? (
        <>
          <rect x="8" y="6" width="12" height="15" rx="2" />
          <path d="M16 3H5a2 2 0 0 0-2 2v12" />
        </>
      ) : name === "more" ? (
        <>
          <circle cx="4" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="20" cy="12" r="1" />
        </>
      ) : name === "chevron" ? (
        <path d="m6 14 6-6 6 6" />
      ) : name === "wifi" ? (
        <>
          <path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0" />
          <circle cx="12" cy="20" r="1" />
        </>
      ) : (
        <>
          <path d="M7 6h10a4 4 0 0 1 4 3l2 9a2 2 0 0 1-3 2l-4-3H8l-4 3a2 2 0 0 1-3-2l2-9a4 4 0 0 1 4-3Z" />
          <path d="M7 9v6M4 12h6M16 11h.01M19 14h.01" />
        </>
      )}
    </svg>
  );
}

const digits = (n: number) => new Intl.NumberFormat("fa-IR").format(n);

export function KahrobaLobbyView({
  room,
  userId,
  displayName,
  photoUrl,
  names,
  connection,
  pending,
  shareEnabled,
  onShare,
  invite,
  message,
  error,
  actions,
}: {
  room: KahrobaLobbyRoom | undefined;
  userId: string | undefined;
  displayName: string | undefined;
  photoUrl: string | null;
  names: Readonly<Record<string, string>>;
  connection: Connection;
  pending: boolean;
  shareEnabled: boolean;
  onShare: () => void;
  invite: KahrobaLobbyInvite | null;
  message: string;
  error: boolean;
  actions?: {
    createEnabled: boolean;
    joinEnabled: boolean;
    invitationDetected: boolean;
    readyEnabled: boolean;
    startEnabled: boolean;
    selfReady: boolean;
    readyUserIds: readonly string[];
    onCreate(capacity: number): void;
    searchEnabled?: boolean;
    onSearch?(capacity: number): void;
    exitEnabled?: boolean;
    onExit?(): void;
    onJoin(): void;
    onReady(): void;
    onStart(): void;
  };
}) {
  const [page, setPage] = useState<"home" | "create">("home");
  const pageRef = useFittedPageScroll<HTMLElement>();
  const { preferences, toggle, sound } = usePalacePreferences();
  const [capacity, setCapacity] = useState(2);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [sheet, setSheet] = useState<
    "profile" | "notifications" | "settings" | "help" | "menu" | null
  >(null);
  const host = !!room && room.hostUserId === userId,
    count = room?.members.length ?? 0,
    slots = room ? Array.from({ length: room.capacity }, (_, seat) => seat) : [],
    connected = connection === "connected";
  return (
    <section
      ref={pageRef}
      className={`khl-lobby ${room ? "khl-private-room" : page === "home" ? "khl-home" : "khl-create-page"} ${!preferences.motion ? "khl-no-motion" : ""}`}
      onClickCapture={sound}
      dir="rtl"
      aria-label="لابی کهربا"
    >
      <header className="khl-header">
        {room || page === "create" ? (
          <button
            type="button"
            onClick={() => {
              if (!room) setPage("home");
              else setSheet("menu");
            }}
            aria-label={room ? "منوی اتاق" : "بازگشت"}
          >
            {room ? <LobbyIcon name="more" /> : <MidnightIcon name="back" />}
          </button>
        ) : (
          <button
            type="button"
            className="khl-profile"
            onClick={() => setSheet("profile")}
            aria-label="پروفایل"
          >
            <AccountAvatar photoUrl={photoUrl} />
            <span dir="auto">{displayName || "بازیکن"}</span>
          </button>
        )}
        <button type="button" aria-label="اعلان‌ها" onClick={() => setSheet("notifications")}>
          <MidnightIcon name="bell" />
        </button>
      </header>
      {!room && (
        <>
          {page === "home" && (
            <>
              <h1 className="khl-sr-only">کهربا</h1>
              <div className="khl-art">
                <img
                  src={kahrobaAssets.lobbyHero}
                  alt="کهربا؛ کارت‌ها و سنگ‌های قیمتی"
                  fetchPriority="high"
                  width="1254"
                  height="1254"
                />
              </div>
            </>
          )}
          {page === "home" ? (
            <>
              <div className="khl-entry-actions">
                <button
                  type="button"
                  disabled={!actions?.createEnabled || pending}
                  onClick={() => setPage("create")}
                  className="khl-create"
                >
                  <PalaceIcon name="create" />
                  <span>
                    <strong>ایجاد اتاق جدید</strong>
                    <small>یک بازی اختصاصی بسازید</small>
                  </span>
                  <span aria-hidden="true">‹</span>
                </button>
                <button
                  type="button"
                  disabled={
                    pending ||
                    !(actions?.invitationDetected ? actions.joinEnabled : actions?.searchEnabled)
                  }
                  onClick={() =>
                    actions?.invitationDetected ? actions.onJoin() : actions?.onSearch?.(capacity)
                  }
                  className="khl-join"
                >
                  <PalaceIcon name="search" />
                  <span>
                    <strong>
                      {actions?.invitationDetected ? "پیوستن با دعوت" : "جستجوی اتاق"}
                    </strong>
                    <small>
                      {actions?.invitationDetected
                        ? "به اتاق دوستان بپیوندید"
                        : "هم‌بازی‌های خود را پیدا کنید"}
                    </small>
                  </span>
                  <span aria-hidden="true">‹</span>
                </button>
              </div>
              <div className="khl-secondary">
                <button type="button" onClick={() => setSheet("settings")}>
                  <PalaceIcon name="settings" />
                  <span>
                    <strong>تنظیمات</strong>
                    <small>نمایش و حساب کاربری</small>
                  </span>
                </button>
                <button type="button" onClick={() => setSheet("help")}>
                  <PalaceIcon name="help" />
                  <span>
                    <strong>راهنمای بازی</strong>
                    <small>قوانین و نکات بازی</small>
                  </span>
                </button>
              </div>
            </>
          ) : (
            <section className="khl-create-form">
              <h1>ایجاد اتاق جدید</h1>
              <p>تنظیمات بازی مورد نظر را انتخاب کنید</p>
              <div className="khl-gem-stage">
                <PalaceGem blue />
              </div>
              <fieldset>
                <legend>تعداد بازیکنان</legend>
                <div className="khl-segments">
                  {[2, 3, 4].map((n) => (
                    <button
                      type="button"
                      key={n}
                      aria-pressed={capacity === n}
                      onClick={() => setCapacity(n)}
                    >
                      {digits(n)} نفره
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>نوع اتاق</legend>
                <div className="khl-segments">
                  <button
                    type="button"
                    aria-pressed={visibility === "private"}
                    onClick={() => setVisibility("private")}
                  >
                    خصوصی<small>فقط با دعوت</small>
                  </button>
                  <button
                    type="button"
                    aria-pressed={visibility === "public"}
                    onClick={() => setVisibility("public")}
                  >
                    عمومی<small>یافتن هم‌بازی</small>
                  </button>
                </div>
              </fieldset>
              <button
                type="button"
                className="khl-create"
                disabled={
                  pending ||
                  !(visibility === "private" ? actions?.createEnabled : actions?.searchEnabled)
                }
                onClick={() =>
                  visibility === "private"
                    ? actions?.onCreate(capacity)
                    : actions?.onSearch?.(capacity)
                }
              >
                ایجاد اتاق
              </button>
            </section>
          )}
        </>
      )}
      {room && (
        <>
          <h1 className="khl-title">اتاق کهربا</h1>
          <section className="khl-room" aria-label="اتاق خصوصی">
            <div className="khl-room-heading">
              <span className={`khl-room-label ${room ? "has-room" : ""}`}>
                <i aria-hidden="true" />
                {room ? "اتاق شما" : "اتاق خصوصی"}
              </span>
              <div className="khl-room-code">
                <small>شناسهٔ اتاق</small>
                <bdi title={room?.id}>
                  {room ? room.id.slice(0, 8).toUpperCase() : "هنوز انتخاب نشده"}
                </bdi>
                <button type="button" disabled aria-label="کپی شناسهٔ اتاق">
                  <LobbyIcon name="copy" />
                </button>
              </div>
              <button
                type="button"
                className="khl-share"
                disabled={!shareEnabled || pending}
                onClick={shareEnabled && !pending ? onShare : undefined}
                aria-busy={pending}
              >
                <LobbyIcon name="share" />
                <span>{pending ? "در حال بررسی…" : "اشتراک‌گذاری"}</span>
              </button>
            </div>

            <div className="khl-room-meta">
              <div className="khl-host">
                <LobbyIcon name="crown" />
                <span>
                  <strong>
                    {host ? "شما میزبان هستید" : room ? "میزبان تعیین شده" : "در انتظار اتاق"}
                  </strong>
                  <small>
                    {room
                      ? `${digits(count)} از ${digits(room.capacity)} بازیکن در اتاق`
                      : "برای دعوت، اتاق معتبر لازم است"}
                  </small>
                </span>
              </div>
              <div>
                <MidnightIcon name="friends" />
                <span>
                  <strong>{room ? `${digits(room.capacity)} نفره` : "—"}</strong>
                  <small>ظرفیت اتاق</small>
                </span>
              </div>
              <div>
                <MidnightIcon name="lock" />
                <span>
                  <strong>خصوصی</strong>
                  <small>فقط با دعوت معتبر</small>
                </span>
              </div>
            </div>

            <div className="khl-players" aria-label="بازیکنان اتاق">
              {slots.length ? (
                slots.map((seat) => {
                  const member = room?.members.find((m) => m.seat === seat),
                    self = member?.userId === userId,
                    isHost = member?.userId === room?.hostUserId;
                  return member ? (
                    <article className={`khl-player ${isHost ? "is-host" : ""}`} key={seat}>
                      <div className="khl-avatar">
                        {self ? (
                          <AccountAvatar photoUrl={photoUrl} />
                        ) : (
                          <MidnightIcon name="profile" />
                        )}
                        {isHost && (
                          <span className="khl-avatar-crown">
                            <LobbyIcon name="crown" />
                          </span>
                        )}
                      </div>
                      <div className="khl-player-info">
                        <strong dir="auto">
                          {self
                            ? displayName || names[member.userId] || "شما"
                            : names[member.userId] || `بازیکن ${digits(seat + 1)}`}
                        </strong>
                        {isHost && <span className="khl-host-badge">میزبان</span>}
                        <small className="khl-member-state">
                          {actions?.readyUserIds.includes(member.userId) ? "آماده است" : "عضو اتاق"}{" "}
                          <span aria-hidden="true">✓</span>
                        </small>
                        {!self && !names[member.userId] && (
                          <bdi className="khl-member-id" title={member.userId}>
                            {member.userId}
                          </bdi>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled
                        aria-label={`گزینه‌های بازیکن ${digits(seat + 1)}`}
                      >
                        <LobbyIcon name="more" />
                      </button>
                    </article>
                  ) : (
                    <article className="khl-player khl-empty-player" key={seat}>
                      <span className="khl-avatar">
                        <MidnightIcon name="profile" />
                      </span>
                      <div>
                        <strong>جای بازیکن {digits(seat + 1)}</strong>
                        <small>در انتظار پیوستن…</small>
                      </div>
                      <button type="button" disabled aria-label={`دعوت بازیکن ${digits(seat + 1)}`}>
                        <LobbyIcon name="plus" />
                      </button>
                    </article>
                  );
                })
              ) : (
                <p className="khl-empty-room">
                  هنوز اتاقی انتخاب نشده است.
                  <br />
                  <small>اطلاعات بازیکنان پس از دریافت اتاق نمایش داده می‌شود.</small>
                </p>
              )}
            </div>

            {actions && room && (
              <button
                type="button"
                className="khl-ready"
                disabled={!actions.readyEnabled || pending}
                onClick={actions.readyEnabled && !pending ? actions.onReady : undefined}
              >
                {actions.selfReady ? "آماده هستید ✓" : "آماده‌ام"}
              </button>
            )}
            <button
              type="button"
              disabled={!actions?.startEnabled || pending}
              onClick={actions?.startEnabled && !pending ? actions.onStart : undefined}
              className="khl-start"
            >
              <MidnightIcon name="play" />
              <span>
                <strong>شروع بازی</strong>
                <small>
                  {room
                    ? `${digits(count)} از ${digits(room.capacity)} بازیکن پیوسته‌اند`
                    : "در انتظار اتاق معتبر"}
                </small>
              </span>
            </button>
            {message && (
              <p
                className={`khl-message ${error ? "is-error" : ""}`}
                role={error ? "alert" : "status"}
              >
                {message}
              </p>
            )}
            {invite && (
              <div className="khl-invite">
                <span>دعوت معتبر اتاق</span>
                <bdi dir="ltr">{invite.deepLink}</bdi>
              </div>
            )}
          </section>
        </>
      )}
      {!room && message && (error || !userId || actions?.invitationDetected) && (
        <p className={`khl-message ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>
          {message}
        </p>
      )}
      <div className={`khl-connection ${connected ? "connected" : ""}`} role="status">
        {connected
          ? "متصل به سرور"
          : connection === "connecting"
            ? "در حال اتصال…"
            : "اتصال برقرار نیست"}
      </div>
      {sheet && (
        <KahrobaSheet
          title={
            {
              profile: "پروفایل",
              notifications: "اعلان‌ها",
              settings: "تنظیمات",
              help: "راهنمای بازی",
              menu: "منوی اتاق",
            }[sheet]
          }
          onClose={() => setSheet(null)}
        >
          {sheet === "menu" && (
            <div className="khl-menu">
              <button
                type="button"
                disabled={!shareEnabled || pending}
                onClick={() => {
                  setSheet(null);
                  onShare();
                }}
              >
                دعوت دوستان
              </button>
              <button type="button" onClick={() => setSheet("help")}>
                راهنمای بازی
              </button>
              <button
                type="button"
                disabled={!actions?.exitEnabled || pending}
                onClick={() => {
                  setSheet(null);
                  actions?.onExit?.();
                }}
              >
                {room && ["WAITING", "FULL"].includes(room.status) ? "خروج از اتاق" : "لغو اتاق"}
              </button>
            </div>
          )}
          {sheet === "profile" && (
            <div className="khl-profile-detail">
              <AccountAvatar photoUrl={photoUrl} />
              <h3 dir="auto">{displayName || "بازیکن"}</h3>
              <p>پروفایل متصل به حساب تلگرام شما</p>
            </div>
          )}
          {sheet === "notifications" && <p>اعلان تازه‌ای برای نمایش وجود ندارد.</p>}
          {sheet === "settings" && (
            <>
              <div className="khl-preference">
                <span>
                  صدای دکمه‌ها<small>صدای کوتاه هنگام لمس کنترل‌ها</small>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-label="صدای دکمه‌ها"
                  aria-checked={preferences.sound}
                  onClick={() => toggle("sound")}
                  className="khl-toggle"
                />
              </div>
              <div className="khl-preference">
                <span>
                  جلوه‌های حرکتی<small>درخشش و حرکت کریستال‌ها</small>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-label="جلوه‌های حرکتی"
                  aria-checked={preferences.motion}
                  onClick={() => toggle("motion")}
                  className="khl-toggle"
                />
              </div>
              <p>تنظیمات روی همین مرورگر ذخیره می‌شوند.</p>
            </>
          )}
          {sheet === "help" && (
            <>
              <p>
                اتاقی با ظرفیت ۲، ۳ یا ۴ نفر بسازید. در اتاق خصوصی، پیوند دعوت را برای دوستان خود
                بفرستید؛ در حالت عمومی، هم‌بازی‌ها از صف جستجو پیدا می‌شوند.
              </p>
              <p>
                پس از تکمیل ظرفیت، همه «آماده‌ام» را انتخاب می‌کنند و میزبان بازی را شروع می‌کند.
              </p>
              <p>
                با جمع‌آوری سنگ‌های قیمتی و خرید کارت‌ها، موتور اقتصادی خود را گسترش دهید و امتیاز
                کسب کنید. جزئیات کارت‌ها و حرکت‌های مجاز روی میز بازی نمایش داده می‌شود.
              </p>
            </>
          )}
        </KahrobaSheet>
      )}
    </section>
  );
}

import type { Connection } from "../../../platform/realtime.js";
import { AccountAvatar, MidnightIcon } from "../../../ui/midnight.js";
import { kahrobaAssets } from "../assets.js";
import type { KahrobaLobbyInvite, KahrobaLobbyRoom } from "../lobby-invitation.js";
import "./lobby.css";

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
}) {
  const host = !!room && room.hostUserId === userId,
    count = room?.members.length ?? 0,
    slots = room ? Array.from({ length: room.capacity }, (_, seat) => seat) : [],
    connected = connection === "connected";
  return (
    <section className="khl-lobby" dir="rtl" aria-label="لابی کهربا">
      <header className="khl-header">
        <button type="button" disabled aria-label="بازگشت">
          <MidnightIcon name="back" />
        </button>
        <h1 aria-label="کهربا">
          <img src={kahrobaAssets.lobbyDecoration} alt="" aria-hidden="true" />
        </h1>
        <div>
          <button type="button" disabled aria-label="راهنما">
            <LobbyIcon name="help" />
          </button>
          <button type="button" disabled aria-label="تنظیمات">
            <MidnightIcon name="gear" />
          </button>
        </div>
      </header>

      <section className="khl-banner" aria-label="بازی فکری رقابتی کهربا">
        <img
          className="khl-banner-reference"
          src={kahrobaAssets.lobbyDecoration}
          alt=""
          aria-hidden="true"
        />
      </section>

      <div className="khl-entry-actions">
        <button type="button" disabled className="khl-create">
          <LobbyIcon name="plus" />
          <span>
            <strong>ایجاد اتاق</strong>
            <small>یک بازی جدید بسازید</small>
          </span>
          <span aria-hidden="true">‹</span>
        </button>
        <button type="button" disabled className="khl-join">
          <MidnightIcon name="friends" />
          <span>
            <strong>ورود با کد</strong>
            <small>به اتاق موجود بپیوندید</small>
          </span>
          <span aria-hidden="true">‹</span>
        </button>
      </div>
      <button type="button" disabled className="khl-guide">
        <MidnightIcon name="book" />
        <span>
          <strong>راهنمای بازی</strong>
          <small>قوانین، آموزش و نکات حرفه‌ای</small>
        </span>
        <span aria-hidden="true">‹</span>
      </button>

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
                    {self ? <AccountAvatar photoUrl={photoUrl} /> : <MidnightIcon name="profile" />}
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
                      عضو اتاق <span aria-hidden="true">✓</span>
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

        <button type="button" disabled className="khl-start">
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
          <p className={`khl-message ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>
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

      <section className="khl-settings" aria-label="تنظیمات بازی">
        <button type="button" disabled className="khl-settings-title" aria-expanded="true">
          <MidnightIcon name="gear" />
          <strong>تنظیمات بازی</strong>
          <LobbyIcon name="chevron" />
        </button>
        <div className="khl-setting-options">
          <div>
            <span>
              <MidnightIcon name="lock" />
              نوع اتاق
            </span>
            <div className="khl-segments">
              <button type="button" disabled aria-pressed="true">
                خصوصی <MidnightIcon name="lock" />
              </button>
              <button type="button" disabled aria-pressed="false">
                عمومی
              </button>
            </div>
          </div>
          <div>
            <span>
              <MidnightIcon name="friends" />
              تعداد بازیکنان
            </span>
            <div className="khl-segments">
              {[2, 3, 4].map((n) => (
                <button type="button" disabled key={n} aria-pressed={room?.capacity === n}>
                  {digits(n)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
      <div className={`khl-connection ${connected ? "connected" : ""}`} role="status">
        <LobbyIcon name="wifi" />
        <strong>
          {connected
            ? "متصل به سرور"
            : connection === "connecting"
              ? "در حال اتصال…"
              : "اتصال برقرار نیست"}
        </strong>
        <small>پینگ اندازه‌گیری نشده</small>
      </div>
      <nav className="khl-bottom-nav" aria-label="ناوبری لابی">
        {(
          [
            ["profile", "پروفایل"],
            ["trophy", "مأموریت‌ها"],
            ["friends", "دوستان"],
            ["game", "بازی‌ها"],
            ["home", "خانه"],
          ] as const
        ).map(([icon, label]) => (
          <button type="button" disabled key={icon} className={icon === "game" ? "is-current" : ""}>
            {icon === "game" ? <LobbyIcon name="game" /> : <MidnightIcon name={icon} />}
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </section>
  );
}

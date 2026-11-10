import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  profileAckSchema,
  profileSchema,
  usernameAvailabilitySchema,
  type Profile,
} from "../../platform/contracts.js";
import { ErrorNotice, useRuntime, useSession, useTask } from "../../ui/shared.js";
import { AccountAvatar, MidnightIcon } from "../../ui/midnight.js";
import { avatarPhoto, officialAvatars } from "../../ui/avatar.js";
import { ownStatsSchema } from "../leaderboard/index.js";
import { AvatarCrop } from "./crop.js";
import { loadUpload, uploadError } from "./image.js";
import { useProfileKeyboard } from "./keyboard.js";
import "./profile.css";

const number = new Intl.NumberFormat("fa-IR");
const leaveMessage = "تغییرات شما ذخیره نشده است. بدون ذخیره خارج می‌شوید؟";
const validUsername = (name: string) => /^[A-Za-z0-9_]{3,32}$/.test(name);
const gameNames: Record<string, string> = {
  coup: "کودتا",
  kahroba: "کهربا",
  hokm: "حکم",
  chess: "شطرنج",
  domino: "دومینو",
  ludo: "منچ",
};
function winRate(played: bigint, wins: bigint) {
  return `${number.format(played ? Number((wins * 1000n) / played) / 10 : 0)}٪`;
}
function ProfileCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: "profile" | "cards" | "trophy";
  children: ReactNode;
}) {
  return (
    <section className="profile-card">
      <h2>
        <span className="profile-section-icon">
          <MidnightIcon name={icon} />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function HubEditor({ profile }: { profile: Profile }) {
  const runtime = useRuntime();
  const task = useTask("fa");
  const logout = useTask("fa");
  const telegramPhoto = useSession((state) => state.photoUrl);
  const [saved, setSaved] = useState(profile);
  const [name, setName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username ?? "");
  const [avatar, setAvatar] = useState(profile.avatar ?? null);
  const [availability, setAvailability] = useState<{
    username: string;
    status: "checking" | "free" | "taken" | "error";
  } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);
  const [imageError, setImageError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const [hideError, setHideError] = useState(false);
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const uploadGeneration = useRef(0);
  const uploadInput = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const hub = useRef<HTMLElement>(null);
  useProfileKeyboard(hub, content);
  const normalizedUsername = username.toLowerCase();
  const usernameChanged = normalizedUsername !== (saved.username ?? "");
  const dirty = name !== saved.displayName || usernameChanged || avatar !== (saved.avatar ?? null);
  const needsGuard = dirty || image !== null || loadingImage;
  const busy = task.blocked || logout.blocked;
  const usernameStatus = !usernameChanged
    ? "unchanged"
    : !validUsername(username)
      ? "taken"
      : availability?.username === normalizedUsername
        ? availability.status
        : "checking";
  const stats = useQuery({
    queryKey: ["statistics", "own", "all_time"],
    queryFn: ({ signal }) =>
      runtime.http("/v1/me/stats?period=all_time", ownStatsSchema, undefined, "GET", true, signal),
  });
  const totals = stats.data?.games.reduce(
    (sum, game) => ({
      played: sum.played + BigInt(game.completed),
      wins: sum.wins + BigInt(game.wins),
      losses: sum.losses + BigInt(game.losses),
    }),
    { played: 0n, wins: 0n, losses: 0n },
  );
  useEffect(() => {
    const controller = new AbortController();
    if (!usernameChanged || !validUsername(username)) return;
    const timer = window.setTimeout(() => {
      setAvailability({ username: normalizedUsername, status: "checking" });
      void runtime
        .http(
          `/v1/me/username-availability?username=${encodeURIComponent(normalizedUsername)}`,
          usernameAvailabilitySchema,
          undefined,
          "GET",
          true,
          controller.signal,
        )
        .then((result) => {
          if (!controller.signal.aborted)
            setAvailability({
              username: normalizedUsername,
              status: result.available ? "free" : "taken",
            });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setAvailability({ username: normalizedUsername, status: "error" });
        });
    }, 550);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [runtime, usernameChanged, username, normalizedUsername, availabilityAttempt]);
  useEffect(() => {
    if (!needsGuard) return;
    const navigate = (event: Event) => {
      if (image) {
        event.preventDefault();
        setImage(null);
        return;
      }
      if (!window.confirm(leaveMessage)) event.preventDefault();
    };
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("hambazi:before-navigate", navigate);
    window.addEventListener("beforeunload", unload);
    window.Telegram?.WebApp?.enableClosingConfirmation?.();
    return () => {
      window.removeEventListener("hambazi:before-navigate", navigate);
      window.removeEventListener("beforeunload", unload);
      window.Telegram?.WebApp?.disableClosingConfirmation?.();
    };
  }, [needsGuard, image]);
  useEffect(
    () => () => {
      uploadGeneration.current++;
    },
    [],
  );
  useEffect(() => {
    if ((task.error || logout.error) && content.current) {
      const shell = hub.current?.closest<HTMLElement>(".midnight-shell");
      const scroller =
        shell?.dataset.profileKeyboard === "true"
          ? shell.querySelector<HTMLElement>(":scope > main")
          : content.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    }
  }, [task.error, logout.error]);
  function applyProfile(value: Profile) {
    setSaved(value);
    setName(value.displayName);
    setUsername(value.username ?? "");
    setAvatar(value.avatar ?? null);
    runtime.query.setQueryData(["profile"], value);
  }
  async function chooseUpload(file: File) {
    const generation = ++uploadGeneration.current;
    const error = uploadError(file);
    setImageError(error ?? "");
    if (error) return;
    setLoadingImage(true);
    try {
      const decoded = await loadUpload(file);
      if (generation === uploadGeneration.current) setImage(decoded);
    } catch {
      if (generation === uploadGeneration.current)
        setImageError("خواندن این عکس ممکن نشد. عکس سالم با فرمت پشتیبانی‌شده انتخاب کنید.");
    } finally {
      if (generation === uploadGeneration.current) setLoadingImage(false);
    }
  }
  return (
    <section ref={hub} className="profile-hub" aria-labelledby="profile-heading">
      <header className="profile-identity">
        <div className="profile-heading-row">
          <h1 id="profile-heading">پروفایل</h1>
          <span className="profile-eyebrow">هویت تو، سبک تو</span>
        </div>
        <div className="profile-person">
          <span className="profile-portrait">
            <AccountAvatar photoUrl={avatarPhoto(avatar, telegramPhoto)} />
            <span className="profile-online" aria-hidden="true" />
          </span>
          <div className="profile-person-copy">
            <strong dir="auto">{name.trim() || saved.displayName}</strong>
            <span dir="ltr">@{username || saved.publicHandle}</span>
            <span className="profile-member">
              <span /> بازیکن هم‌بازی
            </span>
          </div>
        </div>
        <dl className="profile-summary" aria-label="خلاصهٔ آمار">
          {[
            { label: "بازی‌ها", value: totals && number.format(totals.played), tone: "cyan" },
            { label: "بردها", value: totals && number.format(totals.wins), tone: "green" },
            { label: "باخت‌ها", value: totals && number.format(totals.losses), tone: "pink" },
            {
              label: "درصد برد",
              value: totals && winRate(totals.played, totals.wins),
              tone: "violet",
            },
          ].map((stat) => (
            <div key={stat.label} className={`profile-stat-${stat.tone}`}>
              <dt>{stat.label}</dt>
              <dd>{stat.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div
        ref={content}
        className="profile-content"
        role="region"
        aria-label="ویرایش پروفایل"
        tabIndex={0}
      >
        <form
          id="profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!dirty || busy || loadingImage || (usernameChanged && usernameStatus !== "free"))
              return;
            setSavedNotice(false);
            setHideError(false);
            const body = {
              schemaVersion: 1,
              commandId: crypto.randomUUID(),
              expectedVersion: saved.version,
              patch: {
                ...(name !== saved.displayName ? { displayName: name } : {}),
                ...(usernameChanged ? { username: normalizedUsername } : {}),
                ...(avatar !== (saved.avatar ?? null) && avatar !== null ? { avatar } : {}),
              },
            };
            task.run(async () => {
              await runtime.http("/v1/me", profileAckSchema, body, "PATCH");
              applyProfile(await runtime.http("/v1/me", profileSchema));
              setSavedNotice(true);
            });
          }}
        >
          <ProfileCard title="اطلاعات حساب" icon="profile">
            <p className="profile-section-help">هم‌بازی‌ها تو را با این نام می‌شناسند.</p>
            <label htmlFor="profile-name">نام نمایشی</label>
            <input
              id="profile-name"
              value={name}
              dir="auto"
              maxLength={256}
              required
              disabled={busy}
              onChange={(event) => {
                setName(event.target.value);
                setSavedNotice(false);
              }}
              aria-describedby="profile-name-hint"
            />
            <p className="profile-field-hint" id="profile-name-hint">
              این نام برای سایر کاربران قابل مشاهده است.
            </p>
            <label htmlFor="profile-username">نام کاربری</label>
            <div
              className={`profile-username-input ${usernameStatus === "taken" ? "invalid" : usernameStatus === "free" ? "valid" : ""}`}
              dir="ltr"
            >
              <span aria-hidden="true">@</span>
              <input
                id="profile-username"
                dir="ltr"
                value={username}
                placeholder={saved.publicHandle}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={32}
                disabled={busy}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setSavedNotice(false);
                }}
                aria-invalid={usernameStatus === "taken"}
                aria-describedby="profile-username-hint profile-username-status"
              />
            </div>
            <p className="profile-field-hint" id="profile-username-hint">
              ۳ تا ۳۲ کاراکتر؛ حروف انگلیسی، عدد و underscore (_)
            </p>
            <p
              id="profile-username-status"
              role="status"
              className={`profile-username-status ${usernameStatus}`}
            >
              {usernameStatus === "free"
                ? "نام کاربری آزاد است"
                : usernameStatus === "taken"
                  ? "نام کاربری نامعتبر"
                  : usernameStatus === "checking"
                    ? "در حال بررسی نام کاربری…"
                    : usernameStatus === "error"
                      ? "بررسی ممکن نشد؛ دوباره تلاش کنید."
                      : "نام کاربری شما در هم‌بازی"}
            </p>
            {usernameStatus === "error" && (
              <button
                type="button"
                className="profile-text-button"
                onClick={() => {
                  setAvailability(null);
                  setAvailabilityAttempt((attempt) => attempt + 1);
                }}
              >
                تلاش دوباره
              </button>
            )}
          </ProfileCard>
          <ProfileCard title="آواتار تو" icon="cards">
            <p className="profile-section-help">یک چهره برای سبک بازی خودت انتخاب کن.</p>
            {(
              [
                ["boys", "آواتارهای پسرانه"],
                ["girls", "آواتارهای دخترانه"],
              ] as const
            ).map(([group, title]) => (
              <fieldset
                className={`profile-avatar-group profile-avatar-group-${group}`}
                key={group}
              >
                <legend>
                  <span className="sr-only">{title}</span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    className="profile-gender-icon"
                  >
                    {group === "boys" ? (
                      <>
                        <circle cx="9" cy="15" r="6" />
                        <path d="m13.5 10.5 7-7M15 3h6v6" />
                      </>
                    ) : (
                      <>
                        <circle cx="12" cy="8" r="6" />
                        <path d="M12 14v8M8 18h8" />
                      </>
                    )}
                  </svg>
                </legend>
                <div className="profile-avatar-grid">
                  {officialAvatars
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <button
                        className="profile-avatar-option"
                        type="button"
                        key={item.id}
                        aria-label={`انتخاب ${item.name}`}
                        aria-pressed={avatar === item.id}
                        disabled={busy}
                        onClick={() => {
                          setAvatar(item.id);
                          setSavedNotice(false);
                        }}
                      >
                        <img src={item.src} alt="" width={80} height={80} loading="lazy" />
                        {avatar === item.id && (
                          <span className="profile-avatar-check" aria-hidden="true">
                            ✓
                          </span>
                        )}
                      </button>
                    ))}
                </div>
              </fieldset>
            ))}
            <p className="profile-field-hint">همهٔ آواتارها برای همه قابل انتخاب‌اند.</p>
            <div className="profile-upload-row">
              <label className="profile-upload-button">
                <span aria-hidden="true">＋</span>
                {loadingImage ? "در حال آماده‌سازی عکس…" : "آپلود عکس دلخواه"}
                <input
                  ref={uploadInput}
                  type="file"
                  aria-label="آپلود عکس دلخواه"
                  accept="image/jpeg,image/png,image/webp,image/heif,image/heic,.heif,.heic"
                  disabled={busy || loadingImage}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void chooseUpload(file);
                  }}
                />
              </label>
              <button
                type="button"
                className="profile-text-button profile-reset-avatar"
                aria-label="آواتار پیش‌فرض هم‌بازی"
                disabled={busy}
                onClick={() => {
                  setAvatar("default");
                  setSavedNotice(false);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="midnight-icon">
                  <path d="M3 10a9 9 0 1 1 2 9M3 4v6h6" />
                </svg>
              </button>
            </div>
            <p className="profile-field-hint" dir="auto">
              JPEG، PNG، WebP، HEIF · حداکثر ۳ مگابایت
            </p>
            {imageError && (
              <p className="profile-upload-error" role="alert">
                {imageError}
              </p>
            )}
          </ProfileCard>
        </form>
        <ProfileCard title="آمار بازی‌ها" icon="trophy">
          <p className="profile-section-help">کارنامهٔ تو در دنیای هم‌بازی</p>
          {stats.isPending ? (
            <p role="status">در حال دریافت آمار…</p>
          ) : stats.error ? (
            <ErrorNotice
              language="fa"
              error={stats.error}
              retry={() => {
                void stats.refetch();
              }}
            />
          ) : !stats.data.games.length ? (
            <p className="profile-empty-stats">ماجراجویی تو از اولین بازی شروع می‌شود.</p>
          ) : (
            stats.data.games.map((game) => (
              <div className="profile-game-stat" key={game.gameId}>
                <div className="profile-game-stat-heading">
                  <strong>{gameNames[game.gameId] ?? game.gameId}</strong>
                  <span>{number.format(BigInt(game.completed))} بازی</span>
                </div>
                <div className="profile-game-stat-numbers">
                  <span>{number.format(BigInt(game.wins))} برد</span>
                  <span>{number.format(BigInt(game.losses))} باخت</span>
                  <strong>{winRate(BigInt(game.completed), BigInt(game.wins))} برد</strong>
                </div>
                <div className="profile-win-track" aria-hidden="true">
                  <span
                    style={{
                      width: `${game.completed === "0" ? 0 : Number((BigInt(game.wins) * 100n) / BigInt(game.completed))}%`,
                    }}
                  />
                </div>
              </div>
            ))
          )}
          <p className="profile-field-hint">
            آمار بازی‌های پایان‌یافته ممکن است با کمی تأخیر به‌روز شود.
          </p>
        </ProfileCard>
        {!hideError && task.notice}
        {!!task.error && (
          <button
            type="button"
            className="profile-text-button"
            disabled={task.blocked}
            onClick={() => {
              if (
                needsGuard &&
                !window.confirm("اطلاعات جدید دریافت شود و پیش‌نویس فعلی کنار گذاشته شود؟")
              )
                return;
              task.run(async () => {
                applyProfile(await runtime.http("/v1/me", profileSchema));
                setHideError(true);
              });
            }}
          >
            دریافت آخرین اطلاعات
          </button>
        )}
        {logout.notice}
      </div>
      <footer className="profile-actions">
        <p role="status" className={savedNotice ? "saved" : ""}>
          {savedNotice
            ? "تغییرات ذخیره شد"
            : dirty
              ? "تغییرات ذخیره‌نشده دارید"
              : "پروفایلت، امضای تو در بازی"}
        </p>
        <div>
          <button
            type="submit"
            form="profile-form"
            className="profile-save"
            disabled={
              !dirty ||
              busy ||
              loadingImage ||
              !name.trim() ||
              (usernameChanged && usernameStatus !== "free")
            }
          >
            {task.pending ? "در حال ذخیره…" : "ذخیرهٔ تغییرات"}
            <span aria-hidden="true">✓</span>
          </button>
          <button
            type="button"
            className="profile-logout"
            disabled={busy || loadingImage}
            onClick={() => {
              if (!needsGuard || window.confirm(leaveMessage)) logout.run(() => runtime.logout());
            }}
          >
            خروج از حساب
          </button>
        </div>
      </footer>
      {image && (
        <AvatarCrop
          returnFocus={uploadInput}
          image={image}
          onCancel={() => setImage(null)}
          onApply={(value) => {
            setAvatar(value);
            setImage(null);
            setSavedNotice(false);
          }}
        />
      )}
    </section>
  );
}

export function ProfileHubScreen() {
  const runtime = useRuntime();
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: ({ signal }) => runtime.http("/v1/me", profileSchema, undefined, "GET", true, signal),
  });
  if (profile.isPending) return <p role="status">در حال بارگذاری پروفایل…</p>;
  if (profile.error && !profile.data)
    return (
      <ErrorNotice
        language="fa"
        error={profile.error}
        retry={() => {
          void profile.refetch();
        }}
      />
    );
  return profile.data ? <HubEditor profile={profile.data} /> : null;
}

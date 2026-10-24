import { go } from "../../ui/shared.js";
import { useLobbyAvailability, availabilityLabel } from "./availability.js";
import { ErrorNotice } from "../../ui/shared.js";
import { MidnightIcon } from "../../ui/midnight.js";
import { LobbyIcon } from "../../ui/lobby-icon.js";

/** Entry cards use authenticated server availability, separate from the read-only catalog. */
export const personalLobbyCatalog = Object.freeze([
  {
    id: "kahroba",
    title: "کهربا",
    artwork: "/assets/home/kahroba-94b0289f428c.webp",
    compactArtwork: "/assets/home/kahroba-compact-f0ffd1725a4f.webp",
    route: "/restricted/kahroba",
  },
  {
    id: "hokm",
    title: "حکم",
    artwork: "/assets/home/hokm-4a8999bf3214.webp",
    compactArtwork: "/assets/home/hokm-compact-509c72d4b92e.webp",
  },
  {
    id: "domino",
    title: "دومینو",
    artwork: "/assets/home/domino-068f68864add.webp",
    compactArtwork: "/assets/home/domino-compact-4eea02a3aa59.webp",
  },
  {
    id: "chess",
    title: "شطرنج",
    artwork: "/assets/home/chess-5f0c34b275df.webp",
    compactArtwork: "/assets/home/chess-compact-935a18136c27.webp",
  },
  {
    id: "ludo",
    title: "منچ",
    artwork: "/assets/home/ludo-c8e10a82c8d8.webp",
    compactArtwork: "/assets/home/ludo-compact-8239849c1461.webp",
  },
  {
    id: "coup",
    title: "کودتا",
    artwork: "/assets/home/coup-2811ce0e87a8.webp",
    compactArtwork: "/assets/home/coup-compact-c91a98d5936d.webp",
    route: "/games/coup",
  },
  {
    id: "uno",
    title: "اونو",
    artwork: "/assets/home/uno-032fab4de19d.webp",
    compactArtwork: "/assets/home/uno-compact-f8ca2a02a989.webp",
    comingSoon: true,
  },
  {
    id: "battleship",
    title: "نبرد کشتی‌ها",
    artwork: "/assets/home/battleship-e991e7dd5b2b.webp",
    compactArtwork: "/assets/home/battleship-compact-d643f71a20aa.webp",
    comingSoon: true,
  },
] as const);

export function HomeBottomNav({ active }: { active: "home" | "profile" }) {
  return (
    <nav className="home-bottom-nav" aria-label="ناوبری اصلی">
      <a href="#/games" aria-current={active === "home" ? "page" : undefined}>
        <LobbyIcon name="games" />
        <span>بازی‌ها</span>
      </a>
      <button disabled aria-label="دوستان، به‌زودی">
        <LobbyIcon name="friends" />
        <span>دوستان</span>
      </button>
      <button disabled aria-label="چت، به‌زودی">
        <LobbyIcon name="chat" />
        <span>چت</span>
      </button>
      <button disabled aria-label="برترین‌ها، به‌زودی">
        <LobbyIcon name="trophy" />
        <span>برترین‌ها</span>
      </button>
      <a href="#/profile" aria-current={active === "profile" ? "page" : undefined}>
        <LobbyIcon name="profile" />
        <span>پروفایل</span>
      </a>
    </nav>
  );
}

export function PersonalLobby() {
  const availability = useLobbyAvailability();
  return (
    <section className="home-screen" aria-labelledby="games-heading">
      <div className="home-banner">
        <img
          src="/assets/home/banner-95092dfe7663.webp"
          srcSet="/assets/home/banner-compact-decff74c918a.webp 800w, /assets/home/banner-95092dfe7663.webp 1200w"
          sizes="(min-width: 650px) 620px, calc(100vw - 30px)"
          alt=""
          width="1200"
          height="544"
          fetchPriority="high"
        />
        <div className="home-banner-copy">
          <strong aria-label="هم‌بازی">
            <span>هم</span>‌بازی
          </strong>
          <dl className="home-activity" aria-label="آمار هم‌بازی؛ به‌زودی">
            <div className="home-activity-online">
              <span className="home-live-dot" aria-hidden="true" />
              <dd aria-label="آمار هنوز در دسترس نیست">—</dd>
              <dt>نفر آنلاین</dt>
            </div>
            <div>
              <MidnightIcon name="cards" />
              <dd aria-label="آمار هنوز در دسترس نیست">—</dd>
              <dt>میز در حال بازی</dt>
            </div>
            <div className="home-activity-today">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M2 12h4v6H2zM8 7h4v11H8zM14 2h4v16h-4z" fill="currentColor" />
              </svg>
              <dd aria-label="آمار هنوز در دسترس نیست">—</dd>
              <dt>بازی امروز</dt>
            </div>
          </dl>
        </div>
      </div>

      <div className="home-section-heading">
        <h1 id="games-heading">
          <MidnightIcon name="cards" /> بازی‌ها
        </h1>
        <button disabled aria-label="همه را ببینید، به‌زودی">
          همه را ببینید <span aria-hidden="true">→</span>
          <small>به‌زودی</small>
        </button>
      </div>
      {availability.error && (
        <ErrorNotice
          error={availability.error}
          language="fa"
          retry={() => {
            void availability.refetch();
          }}
        />
      )}
      <div className="home-game-grid" role="region" aria-label="فهرست بازی‌ها" tabIndex={0}>
        {personalLobbyCatalog.map((game) => {
          const state =
            "comingSoon" in game
              ? "COMING_SOON"
              : availability.error
                ? undefined
                : availability.data?.lobbyAvailability?.find((item) => item.id === game.id)?.state;
          const enabled = state === "AVAILABLE" && "route" in game;
          const label = availabilityLabel(state);
          return (
            <button
              key={game.id}
              className={`home-game-card home-game-${game.id}${enabled ? "" : " home-game-unavailable"}`}
              disabled={!enabled}
              aria-label={`${game.title}، ${label}`}
              onClick={() => {
                if (enabled && "route" in game) go(game.route);
              }}
            >
              <img
                src={game.artwork}
                srcSet={`${game.compactArtwork} 600w, ${game.artwork} 1200w`}
                sizes="(min-width: 650px) 303px, calc((100vw - 44px) / 2)"
                alt=""
                width="1200"
                height="660"
                decoding="async"
              />
              <span className="home-card-title">{game.title}</span>
              {enabled && (
                <span className="home-card-arrow" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="m9 5 7 7-7 7" />
                  </svg>
                </span>
              )}
              {!enabled && (
                <span className="home-card-badge">
                  <MidnightIcon name="lock" />
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

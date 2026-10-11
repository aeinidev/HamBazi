import { go } from "../../ui/shared.js";
import { MidnightIcon } from "../../ui/midnight.js";

/** The admitted personal Coup flow is separate from the read-only public catalog. */
export const personalLobbyCatalog = Object.freeze([
  { id: "kahroba", title: "کهربا", enabled: false, artwork: "/assets/midnight/kahroba-art.webp" },
  { id: "hokm", title: "حکم", enabled: false, artwork: "/assets/midnight/hokm-art.webp" },
  { id: "domino", title: "دومینو", enabled: false, artwork: "/assets/midnight/domino-art.webp" },
  { id: "chess", title: "شطرنج", enabled: false, artwork: "/assets/midnight/chess-art.webp" },
  { id: "ludo", title: "منچ", enabled: false, artwork: "/assets/midnight/ludo-art.webp" },
  {
    id: "coup",
    title: "کودتا",
    enabled: true,
    artwork: "/assets/midnight/coup-art.webp",
    route: "/games/coup",
  },
] as const);

export function HomeBottomNav({ active }: { active: "home" | "profile" }) {
  return (
    <nav className="home-bottom-nav" aria-label="ناوبری اصلی">
      <a href="#/games" aria-current={active === "home" ? "page" : undefined}>
        <MidnightIcon name="home" />
        <span>خانه</span>
      </a>
      <button disabled aria-label="جدول، به‌زودی">
        <MidnightIcon name="trophy" />
        <span>جدول</span>
        <small>به‌زودی</small>
      </button>
      <button disabled aria-label="دوستان، به‌زودی">
        <MidnightIcon name="friends" />
        <span>دوستان</span>
        <small>به‌زودی</small>
      </button>
      <a href="#/profile" aria-current={active === "profile" ? "page" : undefined}>
        <MidnightIcon name="profile" />
        <span>پروفایل</span>
      </a>
    </nav>
  );
}

export function PersonalLobby() {
  return (
    <section className="home-screen" aria-labelledby="games-heading">
      <div className="home-banner">
        <img src="/assets/midnight/home-banner.webp" alt="" width="1200" height="544" />
        <div className="home-banner-copy">
          <strong aria-label="هم‌بازی">
            <span>هم</span>‌بازی
          </strong>
          <p>
            بازی‌های جذاب،
            <br />
            با دوستان بهتر است.
          </p>
          <button disabled aria-label="بازی پیدا کن، به‌زودی">
            بازی پیدا کن <small>به‌زودی</small>
          </button>
        </div>
      </div>

      <div className="home-section-heading">
        <h1 id="games-heading">
          <MidnightIcon name="cards" /> بازی‌ها
        </h1>
        <button disabled aria-label="همه را ببینید، به‌زودی">
          همه را ببینید <span>←</span>
          <small>به‌زودی</small>
        </button>
      </div>
      <div className="home-game-grid" aria-label="فهرست بازی‌ها">
        {personalLobbyCatalog.map((game) => (
          <button
            key={game.id}
            className={`home-game-card home-game-${game.id}`}
            disabled={!game.enabled}
            aria-label={`${game.title}، ${game.enabled ? "فعال" : "به‌زودی"}`}
            onClick={() => {
              if (game.enabled && "route" in game) go(game.route);
            }}
          >
            <img src={game.artwork} alt="" width="800" height="450" loading="lazy" />
            <span className="home-card-title">{game.title}</span>
            {game.enabled ? (
              <span className="home-card-arrow" aria-hidden="true">
                ‹
              </span>
            ) : (
              <span className="home-card-badge">به‌زودی</span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

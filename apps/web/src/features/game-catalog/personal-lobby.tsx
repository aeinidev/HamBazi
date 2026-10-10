import { go } from "../../ui/shared.js";
import { MidnightIcon, OrnateFrame } from "../../ui/midnight.js";

/** Presentation for the admitted personal-game scope, not public catalog activation. */
export const personalLobbyCatalog = Object.freeze([
  {
    id: "coup",
    title: "کودتا",
    enabled: true,
    artwork: "/assets/midnight/coup-art.webp",
    route: "/games/coup",
  },
  {
    id: "hokm",
    title: "حکم",
    enabled: false,
    artwork: "/assets/midnight/hokm-art.webp",
    route: null,
  },
  {
    id: "ludo",
    title: "منچ",
    enabled: false,
    artwork: "/assets/midnight/ludo-art.webp",
    route: null,
  },
] as const);

export function PersonalLobby() {
  return (
    <section className="midnight-lobby" aria-labelledby="games-heading">
      <div className="lobby-intro">
        <h1 id="games-heading" className="display-title">
          <span>بازی‌ها</span>
        </h1>
        <div className="gold-divider" aria-hidden="true">
          ✧
        </div>
        <p>بازی خود را انتخاب کنید</p>
      </div>
      <div className="midnight-catalog" aria-label="فهرست بازی‌ها">
        {personalLobbyCatalog.map((game) => (
          <button
            key={game.id}
            className={`midnight-game-tile ${game.enabled ? "featured" : "coming-soon"}`}
            disabled={!game.enabled}
            aria-label={`${game.title}، ${game.enabled ? "فعال" : "به‌زودی"}`}
            onClick={() => {
              if (game.enabled && game.route) go(game.route);
            }}
          >
            <OrnateFrame>
              <img
                src={game.artwork}
                alt=""
                width={game.enabled ? 960 : 800}
                height={game.enabled ? 720 : 450}
                loading={game.enabled ? "eager" : "lazy"}
              />
              <span className="tile-caption">
                <span className="tile-title">{game.title}</span>
                <span className="tile-badge">
                  {!game.enabled && <MidnightIcon name="lock" />}
                  {game.enabled ? "فعال" : "به‌زودی"}
                </span>
                {game.enabled && (
                  <span className="tile-arrow">
                    <MidnightIcon name="back" />
                  </span>
                )}
              </span>
            </OrnateFrame>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Presentation only; the launch shell owns the minimum duration and readiness gates. */
export function HamBaziLoading({ leaving = false }: { leaving?: boolean }) {
  return (
    <div
      className={`hambazi-loading${leaving ? " is-leaving" : ""}`}
      role="status"
      lang="fa"
      aria-label="در حال بارگذاری هم‌بازی"
    >
      <div className="hambazi-loading-stars" aria-hidden="true" />
      <div className="hambazi-loading-scene">
        <img
          className="hambazi-loading-art"
          src="/assets/loading/tabletop-extended-640-f0d102a98360.webp"
          srcSet="/assets/loading/tabletop-extended-640-f0d102a98360.webp 640w, /assets/loading/tabletop-extended-1024-3fab4717a03b.webp 1024w"
          sizes="(max-height: 380px) 52vw, (max-width: 640px) 100vw, 640px"
          width="1024"
          height="1792"
          alt=""
          fetchPriority="high"
          decoding="async"
        />
      </div>
      <div className="hambazi-loading-content" aria-hidden="true">
        <div className="hambazi-loading-mark" />
        <div className="hambazi-loading-name">
          <span>هم</span>‌بازی
        </div>
        <p className="hambazi-loading-tagline">دور هم بازی کنیم، خاطره بسازیم</p>
        <div className="hambazi-loading-progress">
          <div className="hambazi-loading-track" />
          <p className="hambazi-loading-caption">
            <span className="hambazi-loading-orbit" />
            در حال آماده‌سازی میز بازی<span className="hambazi-loading-dots">…</span>
          </p>
        </div>
      </div>
      <div className="hambazi-loading-footer" aria-hidden="true">
        <span>✦</span> کنار هم، بیشتر خوش می‌گذره <span>✦</span>
      </div>
    </div>
  );
}

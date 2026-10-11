/** No timer or minimum duration: callers remove this as soon as their data is ready. */
export function HamBaziLoading() {
  return (
    <div className="hambazi-loading" role="status" lang="fa" aria-label="در حال بارگذاری هم‌بازی">
      <div className="hambazi-loading-mark" aria-hidden="true">
        <svg viewBox="0 0 40 40">
          <rect x="13" y="7" width="21" height="27" rx="4" />
          <path d="m10 9-5 2 3 23 5-1M24 16c-4-5-10 2 0 8 10-6 4-13 0-8Z" />
        </svg>
      </div>
      <div className="hambazi-loading-name" aria-hidden="true">
        <span>هم</span>‌بازی
      </div>
      <p aria-hidden="true">در حال بارگذاری…</p>
      <div className="hambazi-loading-track" aria-hidden="true" />
    </div>
  );
}

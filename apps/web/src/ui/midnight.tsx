import type { ReactNode } from "react";

export function MidnightIcon({ name }: { name: "back" | "gear" | "book" | "play" | "lock" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`midnight-icon icon-${name}`}
    >
      {name === "back" ? (
        <path d="m15 4-8 8 8 8" />
      ) : name === "play" ? (
        <path d="M7 3v18l15-9Z" fill="currentColor" stroke="none" />
      ) : name === "lock" ? (
        <>
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
        </>
      ) : name === "book" ? (
        <>
          <path d="M12 5C8 2 4 3 2 4v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-2-1-6-2-10 1ZM12 5v16" />
        </>
      ) : (
        <>
          <path d="m9 2-1 3-3 1-3-1-1 4 2 2v3l-2 2 2 4 3-1 2 1 1 3h5l1-3 3-1 3 1 2-4-2-2v-3l2-2-2-4-3 1-3-1-1-3Z" />
          <circle cx="12" cy="12" r="4" />
        </>
      )}
    </svg>
  );
}

export function Filigree({ className = "" }: { className?: string }) {
  return (
    <svg className={`filigree ${className}`} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M3 45V14C3 7 7 3 14 3h31M8 40V16c0-5 3-8 8-8h24M5 29c8-14 27-12 18-4-5 4-11-1-7-5M29 5c-14 8-12 27-4 18 4-5-1-11-5-7M5 43c15-3 24-12 31-27M43 5C28 8 19 17 12 32M8 35l6-2-2 6-4-4ZM35 8l-2 6 6-2-4-4Z" />
    </svg>
  );
}

export function OrnateFrame({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ornate-frame ${className}`}>
      <Filigree className="corner top-left" />
      <Filigree className="corner top-right" />
      <Filigree className="corner bottom-left" />
      <Filigree className="corner bottom-right" />
      {children}
    </div>
  );
}

export function MidnightHeader({
  back,
  onSettings,
}: {
  back?: (() => void) | undefined;
  onSettings: () => void;
}) {
  return (
    <header className="midnight-header" aria-label="هم‌بازی">
      <div className="header-back">
        {back && (
          <button className="midnight-square" onClick={back} aria-label="بازگشت">
            <MidnightIcon name="back" />
          </button>
        )}
      </div>
      <a className="midnight-brand" href="#/games" dir="ltr" aria-label="HamBazi، صفحهٔ بازی‌ها">
        HamBazi
      </a>
      <button className="midnight-square header-settings" onClick={onSettings} aria-label="تنظیمات">
        <MidnightIcon name="gear" />
      </button>
    </header>
  );
}

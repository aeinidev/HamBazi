import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { profileSchema } from "../platform/contracts.js";
import { useRuntime, useSession } from "./shared.js";

export function AccountAvatar({ photoUrl }: { photoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  return photoUrl && !failed ? (
    <img
      className="account-avatar"
      src={photoUrl}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="account-avatar fallback-avatar" aria-hidden="true">
      هم
    </span>
  );
}

export function MidnightIcon({
  name,
}: {
  name:
    | "back"
    | "gear"
    | "book"
    | "play"
    | "lock"
    | "bell"
    | "cards"
    | "home"
    | "friends"
    | "trophy"
    | "profile";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`midnight-icon icon-${name}`}
    >
      {name === "back" ? (
        <path d="m15 4-8 8 8 8" />
      ) : name === "bell" ? (
        <>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
          <path d="M12 2V1" />
        </>
      ) : name === "cards" ? (
        <>
          <rect x="7" y="4" width="14" height="17" rx="2" transform="rotate(10 14 12)" />
          <path d="M5 6 2 7v14h13" />
          <path d="m14 10 1 2 2 1-2 1-1 2-1-2-2-1 2-1Z" />
        </>
      ) : name === "home" ? (
        <>
          <path d="m3 11 9-8 9 8v10h-6v-7H9v7H3Z" />
        </>
      ) : name === "friends" ? (
        <>
          <circle cx="8" cy="8" r="3" />
          <path d="M2 20v-2a6 6 0 0 1 12 0v2ZM17 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 5 5v1h-5" />
        </>
      ) : name === "trophy" ? (
        <>
          <path d="M7 3h10v8a5 5 0 0 1-10 0V3ZM7 5H3v3a4 4 0 0 0 4 4M17 5h4v3a4 4 0 0 1-4 4M12 16v4M8 21h8" />
        </>
      ) : name === "profile" ? (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="12" r="10" />
        </>
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
  home = false,
}: {
  back?: (() => void) | undefined;
  onSettings: () => void;
  home?: boolean;
}) {
  const runtime = useRuntime();
  const session = useSession((state) => state.session);
  const photoUrl = useSession((state) => state.photoUrl);
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: ({ signal }) => runtime.http("/v1/me", profileSchema, undefined, "GET", true, signal),
    enabled: !!session,
  });
  if (home && session)
    return (
      <header className="home-header" aria-label="هم‌بازی">
        <div className="home-identity">
          <AccountAvatar photoUrl={photoUrl} />
          <span dir="auto">{profile.data?.displayName ?? "هم‌بازی"}</span>
        </div>
        <div className="home-header-actions">
          <button disabled aria-label="اعلان‌ها، به‌زودی" title="اعلان‌ها، به‌زودی">
            <MidnightIcon name="bell" />
          </button>
          <button onClick={onSettings} aria-label="تنظیمات">
            <MidnightIcon name="gear" />
          </button>
        </div>
      </header>
    );
  return (
    <header className="midnight-header" aria-label="هم‌بازی">
      <div className="header-back">
        {back && (
          <button className="midnight-square" onClick={back} aria-label="بازگشت">
            <MidnightIcon name="back" />
          </button>
        )}
      </div>
      {session ? (
        <div className="header-identity">
          <AccountAvatar photoUrl={photoUrl} />
          <span dir="auto">{profile.data?.displayName ?? "هم‌بازی"}</span>
        </div>
      ) : (
        <a className="midnight-brand" href="#/games" dir="ltr" aria-label="HamBazi، صفحهٔ بازی‌ها">
          HamBazi
        </a>
      )}
      <button className="midnight-square header-settings" onClick={onSettings} aria-label="تنظیمات">
        <MidnightIcon name="gear" />
      </button>
    </header>
  );
}

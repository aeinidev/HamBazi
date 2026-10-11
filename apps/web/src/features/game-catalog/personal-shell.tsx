import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { profileSchema } from "../../platform/contracts.js";
import { HamBaziLoading } from "../../ui/loading.js";
import type { TelegramApp } from "../../platform/telegram.js";
import { AuthScreen } from "../auth/index.js";
import { PersonalGame } from "../personal-game/index.js";
import { SettingsScreen } from "../profile/index.js";
import { CoupEntry, CoupTutorial } from "../../games/coup/index.js";
import { MidnightHeader } from "../../ui/midnight.js";
import { ErrorNotice, go, useRuntime, useSession } from "../../ui/shared.js";
import { HomeBottomNav, PersonalLobby } from "./personal-lobby.js";

export function PersonalLobbyShell({ telegram }: { telegram?: TelegramApp | undefined }) {
  const session = useSession((s) => s.session);
  const runtime = useRuntime();
  const identity = useQuery({
    queryKey: ["profile"],
    queryFn: ({ signal }) => runtime.http("/v1/me", profileSchema, undefined, "GET", true, signal),
    enabled: !!session,
  });
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || "/games");
  const [startIntent, setStartIntent] = useState<string | undefined>();
  const [opening, setOpening] = useState(false);
  const entering = useRef(false);
  const playing = route === "/games/coup/play" || /^\/match\/[0-9a-f-]{36}$/i.test(route);
  const tutorial = route === "/games/coup/tutorial";
  const entry = route === "/games/coup";
  const settings = route === "/settings";
  const profile = route === "/profile";
  const home = route === "/games";
  const homeFrame = home || profile;
  const unavailable = !home && !profile && !settings && !entry && !tutorial && !playing;
  const backPath = tutorial || playing ? "/games/coup" : "/games";
  const hasBack = !!session && !home;
  const back = useCallback(() => go(backPath), [backPath]);
  const consumed = useCallback(() => {
    setStartIntent(undefined);
    setOpening(false);
    entering.current = false;
  }, []);
  useEffect(() => {
    const change = () => {
      setRoute(window.location.hash.slice(1) || "/games");
      entering.current = false;
      setOpening(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    telegram?.BackButton?.onClick(back);
    if (hasBack) telegram?.BackButton?.show();
    else telegram?.BackButton?.hide();
    document.getElementById("main")?.focus();
    return () => {
      telegram?.BackButton?.offClick(back);
      telegram?.BackButton?.hide();
    };
  }, [telegram, back, hasBack, route, session]);
  function begin() {
    if (entering.current) return;
    entering.current = true;
    setOpening(true);
    setStartIntent(startIntent ?? crypto.randomUUID());
    go("/games/coup/play");
  }
  // Keep the initial home hidden until the authenticated name is available.
  if (session && homeFrame && !identity.data) {
    if (identity.error)
      return (
        <div className="app-shell midnight-shell" lang="fa" dir="rtl">
          <ErrorNotice
            error={identity.error}
            language="fa"
            retry={() => {
              void identity.refetch();
            }}
          />
        </div>
      );
    return <HamBaziLoading />;
  }
  return (
    <div
      className={`app-shell midnight-shell ${homeFrame && session ? "home-shell" : ""}`}
      dir="rtl"
      lang="fa"
    >
      <a
        className="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        رفتن به محتوا
      </a>
      <MidnightHeader
        back={hasBack && !homeFrame ? back : undefined}
        home={homeFrame}
        onSettings={() => go("/settings")}
      />
      <main id="main" tabIndex={-1} key={session?.sessionId ?? "guest"}>
        {!session ? (
          <AuthScreen />
        ) : tutorial ? (
          <CoupTutorial />
        ) : entry ? (
          <CoupEntry onStart={begin} pending={opening} />
        ) : playing ? (
          <PersonalGame startIntent={startIntent} onStartConsumed={consumed} />
        ) : settings || profile ? (
          <SettingsScreen title={profile ? "پروفایل" : "تنظیمات"} />
        ) : unavailable ? (
          <section className="home-unavailable" role="status">
            <h1>به‌زودی</h1>
            <p>این بخش هنوز برای بازی آماده نیست.</p>
            <a href="#/games">بازگشت به خانه</a>
          </section>
        ) : (
          <PersonalLobby />
        )}
      </main>
      {session && homeFrame && <HomeBottomNav active={profile ? "profile" : "home"} />}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { profileSchema } from "../../platform/contracts.js";
import { HamBaziLoading } from "../../ui/loading.js";
import type { TelegramApp } from "../../platform/telegram.js";
import { AuthScreen } from "../auth/index.js";
import { PersonalGame } from "../personal-game/index.js";
import { SettingsScreen } from "../profile/index.js";
import { useLobbyAvailability, availabilityLabel } from "./availability.js";
import { CoupEntry, CoupTutorial } from "../../games/coup/index.js";
import { MidnightHeader } from "../../ui/midnight.js";
import { ErrorNotice, go, useRuntime, useSession } from "../../ui/shared.js";
import { HomeBottomNav, PersonalLobby } from "./personal-lobby.js";
import { useFittedPageScroll } from "../../ui/fitted-page-scroll.js";

export function PersonalLobbyShell({ telegram }: { telegram?: TelegramApp | undefined }) {
  const session = useSession((s) => s.session);
  const runtime = useRuntime();
  const availability = useLobbyAvailability();
  const coupState = availability.error
    ? undefined
    : availability.data?.lobbyAvailability?.find((game) => game.id === "coup")?.state;
  const canStart = coupState === "AVAILABLE";
  const identity = useQuery({
    queryKey: ["profile"],
    queryFn: ({ signal }) => runtime.http("/v1/me", profileSchema, undefined, "GET", true, signal),
    enabled: !!session,
  });
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || "/games");
  const [startIntent, setStartIntent] = useState<string | undefined>();
  const [opening, setOpening] = useState(false);
  const [launchDelayElapsed, setLaunchDelayElapsed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLaunchDelayElapsed(true), 3000);
    return () => window.clearTimeout(timer);
  }, []);
  const entering = useRef(false);
  const playing = route === "/games/coup/play" || /^\/match\/[0-9a-f-]{36}$/i.test(route);
  const tutorial = route === "/games/coup/tutorial";
  const entry = route === "/games/coup";
  const settings = route === "/settings";
  const profile = route === "/profile";
  const home = route === "/games";
  const homeFrame = home || profile;
  const [launchComplete, setLaunchComplete] = useState(false);
  const launchReady = !!session && launchDelayElapsed && (!homeFrame || !!identity.data);
  useEffect(() => {
    if (!launchReady || launchComplete) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setLaunchComplete(true), reducedMotion ? 0 : 360);
    return () => window.clearTimeout(timer);
  }, [launchReady, launchComplete]);
  const pageRef = useFittedPageScroll<HTMLDivElement>(
    !session || home || profile || settings || entry,
  );
  const unavailable = !home && !profile && !settings && !entry && !tutorial && !playing;
  const backPath = (tutorial || playing) && canStart ? "/games/coup" : "/games";
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
    if (!canStart || entering.current) return;
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
  if (session && !launchComplete) return <HamBaziLoading leaving={launchReady} />;
  return (
    <div
      ref={pageRef}
      className={`app-shell midnight-shell ${session && launchComplete ? "hambazi-launch-arrival" : ""} ${homeFrame && session ? "home-shell" : ""}`}
      data-screen={
        !session
          ? "auth"
          : home
            ? "home"
            : profile
              ? "profile"
              : settings
                ? "settings"
                : entry
                  ? "entry"
                  : undefined
      }
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
      {session && (
        <MidnightHeader
          back={hasBack && !homeFrame ? back : undefined}
          home={homeFrame}
          onSettings={() => go("/settings")}
        />
      )}
      <main id="main" tabIndex={-1} key={session?.sessionId ?? "guest"}>
        {!session ? (
          <AuthScreen />
        ) : (entry || tutorial) && !canStart ? (
          <section className="home-unavailable" role="status">
            <h1>کودتا — {availabilityLabel(coupState)}</h1>
            <a href="#/games/coup/play">ادامهٔ بازی موجود</a>
            <a href="#/games">بازگشت به خانه</a>
          </section>
        ) : tutorial ? (
          <CoupTutorial />
        ) : entry ? (
          <CoupEntry onStart={begin} pending={opening} />
        ) : playing ? (
          <PersonalGame
            key={route}
            canStart={canStart}
            matchId={route.startsWith("/match/") ? route.slice(7) : undefined}
            startIntent={canStart ? startIntent : undefined}
            onStartConsumed={consumed}
          />
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

import { useCallback, useEffect, useRef, useState } from "react";
import type { TelegramApp } from "../../platform/telegram.js";
import { AuthScreen } from "../auth/index.js";
import { PersonalGame } from "../personal-game/index.js";
import { SettingsScreen } from "../profile/index.js";
import { CoupEntry, CoupTutorial } from "../../games/coup/index.js";
import { MidnightHeader } from "../../ui/midnight.js";
import { go, useSession } from "../../ui/shared.js";
import { PersonalLobby } from "./personal-lobby.js";

export function PersonalLobbyShell({ telegram }: { telegram?: TelegramApp | undefined }) {
  const session = useSession((s) => s.session);
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || "/games");
  const [startIntent, setStartIntent] = useState<string | undefined>();
  const [opening, setOpening] = useState(false);
  const entering = useRef(false);
  const playing = route === "/games/coup/play" || /^\/match\/[0-9a-f-]{36}$/i.test(route);
  const tutorial = route === "/games/coup/tutorial";
  const entry = route === "/games/coup";
  const settings = route === "/settings";
  const backPath = tutorial || playing ? "/games/coup" : "/games";
  const hasBack = !!session && (tutorial || entry || playing || settings);
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
  return (
    <div className="app-shell midnight-shell" dir="rtl" lang="fa">
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
      <MidnightHeader back={hasBack ? back : undefined} onSettings={() => go("/settings")} />
      <main id="main" tabIndex={-1} key={session?.sessionId ?? "guest"}>
        {!session ? (
          <AuthScreen />
        ) : tutorial ? (
          <CoupTutorial />
        ) : entry ? (
          <CoupEntry onStart={begin} pending={opening} />
        ) : playing ? (
          <PersonalGame startIntent={startIntent} onStartConsumed={consumed} />
        ) : settings ? (
          <SettingsScreen />
        ) : (
          <PersonalLobby />
        )}
      </main>
    </div>
  );
}

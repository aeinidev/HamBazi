import { LeaderboardScreen } from "./features/leaderboard/index.js";
import { useEffect, useState } from "react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { Runtime } from "./platform/runtime.js";
import type { TelegramApp } from "./platform/telegram.js";
import { AuthScreen } from "./features/auth/index.js";
import { ProfileScreen } from "./features/profile/index.js";
import { CatalogScreen, LobbyScreen, PersonalLobbyShell } from "./features/game-catalog/index.js";
import { InviteScreen, RoomScreen } from "./features/room/index.js";
import { MatchmakingScreen } from "./features/matchmaking/index.js";
import { MatchScreen } from "./platform/match-screen.js";
import { DirectCoupPreview } from "./dev/coup-preview.js";
import { RuntimeContext, go, useRuntime, useSession } from "./ui/shared.js";
import { profileSchema } from "./platform/contracts.js";
function Shell({
  telegram,
  localPreview,
  directCoupPreviewMatchId,
}: {
  telegram?: TelegramApp | undefined;
  localPreview: boolean;
  directCoupPreviewMatchId?: string | undefined;
}) {
  const runtime = useRuntime();
  const preview = import.meta.env.DEV && localPreview;
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || "/games");
  const directPreview =
    preview &&
    route === "/preview/coup" &&
    !!directCoupPreviewMatchId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      directCoupPreviewMatchId,
    );
  const session = useSession((s) => s.session);
  const connection = useSession((s) => s.connection);
  const ticket = useSession((s) => s.ticket);
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: ({ signal }) => runtime.http("/v1/me", profileSchema, undefined, "GET", true, signal),
    enabled: !!session,
  });
  useEffect(() => {
    document.documentElement.dataset.theme = profile.data?.settings.theme ?? "system";
  }, [profile.data]);
  useEffect(() => {
    const change = () => setRoute(window.location.hash.slice(1) || "/games");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const back = () => go("/games");
    telegram?.BackButton?.onClick(back);
    if (route !== "/games" && session) telegram?.BackButton?.show();
    else telegram?.BackButton?.hide();
    document.querySelector<HTMLElement>("main")?.focus();
    return () => telegram?.BackButton?.offClick(back);
  }, [route, session, telegram]);
  let screen = <CatalogScreen />;
  const path = route.split("/");
  if (path[1] === "leaderboard" && path[2])
    screen = <LeaderboardScreen key={path[2]} gameId={path[2]} />;
  else if (route === "/profile") screen = <ProfileScreen />;
  else if (route === "/invite") screen = <InviteScreen />;
  else if (route === "/search") screen = <MatchmakingScreen />;
  else if (path[1] === "games" && path[2]) screen = <LobbyScreen slug={path[2]} />;
  else if (path[1] === "rooms" && path[2]) screen = <RoomScreen id={path[2]} />;
  else if (path[1] === "match" && path[2]) screen = <MatchScreen id={path[2]} />;
  return (
    <div className="app-shell">
      <a
        className="skip"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header>
        <a className="brand" href="#/games">
          <span className="brand-mark" aria-hidden="true">
            H
          </span>
          HamBazi
        </a>
        {session && (
          <span className="connection" role="status">
            <span className={`dot ${connection === "connected" ? "online" : ""}`} />
            {connection === "connected"
              ? "Connected"
              : connection === "connecting"
                ? "Connecting"
                : "Reconnecting"}
          </span>
        )}
      </header>
      {preview && (
        <div className="notice" role="status">
          Local preview · synthetic Telegram identity and server data ·{" "}
          <a href="#/preview/coup">Open Coup table</a>
        </div>
      )}
      {session && connection !== "connected" && (
        <div className="notice" role="status">
          Live connection unavailable. Your server session is preserved.{" "}
          <button className="text-button" onClick={() => runtime.realtime().retry()}>
            Reconnect
          </button>
        </div>
      )}
      <main id="main" tabIndex={-1} key={session?.sessionId ?? "guest"}>
        {directPreview ? (
          <DirectCoupPreview matchId={directCoupPreviewMatchId} />
        ) : session ? (
          screen
        ) : (
          <AuthScreen localPreview={preview} />
        )}
      </main>
      {session && (
        <nav aria-label="Main navigation">
          <a aria-current={route.startsWith("/games") ? "page" : undefined} href="#/games">
            Games
          </a>
          {ticket && (
            <a aria-current={route === "/search" ? "page" : undefined} href="#/search">
              Your search
            </a>
          )}
          <a
            aria-current={route.startsWith("/leaderboard/") ? "page" : undefined}
            href="#/leaderboard/coup"
          >
            Leaderboard
          </a>
          <a aria-current={route === "/profile" ? "page" : undefined} href="#/profile">
            Profile
          </a>
        </nav>
      )}
    </div>
  );
}
export function App({
  runtime,
  telegram,
  localPreview = false,
  directCoupPreviewMatchId,
}: {
  runtime: Runtime;
  telegram?: TelegramApp | undefined;
  localPreview?: boolean;
  directCoupPreviewMatchId?: string | undefined;
}) {
  return (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.query}>
        {runtime.scope === "owner-auth" ? (
          <PersonalLobbyShell telegram={telegram} />
        ) : (
          <Shell
            telegram={telegram}
            localPreview={localPreview}
            directCoupPreviewMatchId={directCoupPreviewMatchId}
          />
        )}
      </QueryClientProvider>
    </RuntimeContext.Provider>
  );
}

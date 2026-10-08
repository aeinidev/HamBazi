import { QueryClient } from "@tanstack/react-query";
import { createStore } from "zustand/vanilla";
import { z } from "zod";
import { parseRoomStartParam } from "@hambazi/contracts";
import { createHttp } from "./http.js";
import { createRealtime, type Connection, type Realtime } from "./realtime.js";
import {
  accountSchema,
  issuedSchema,
  type Session,
  type Snapshot,
  type Ticket,
} from "./contracts.js";
import { ClientError } from "./errors.js";
import {
  diagnosticErrorCode,
  type TelegramDiagnostics,
  type TelegramStartup,
} from "./telegram-diagnostics.js";
import { publicSnapshot } from "../games/index.js";
export interface State {
  telegramDiagnostics: TelegramDiagnostics | null;
  session: Session | null;
  expired: boolean;
  connection: Connection;
  snapshot: Snapshot | null;
  resyncNeeded: boolean;
  realtimeError: ClientError | null;
  invite: string | null;
  ticket: Ticket | null;
}
export function createRuntime(
  origin: string,
  initialInitData: string,
  fetcher: typeof fetch = fetch,
  realtimeFactory = createRealtime,
  scope: "full" | "owner-auth" = "full",
  startup?: TelegramStartup,
) {
  const parsedOrigin = new URL(origin);
  if (
    parsedOrigin.origin !== origin ||
    (parsedOrigin.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(parsedOrigin.hostname))
  )
    throw new Error("Invalid API origin");
  let initData = initialInitData;
  let token: string | null = null;
  let realtime: Realtime | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const startParam = new URLSearchParams(initData).get("start_param");
  const store = createStore<State>(() => ({
    telegramDiagnostics: startup
      ? { ...startup, authentication: "not-requested", errorCode: null }
      : null,
    session: null,
    expired: false,
    connection: "offline",
    snapshot: null,
    resyncNeeded: false,
    realtimeError: null,
    invite: scope === "full" && startParam && parseRoomStartParam(startParam) ? startParam : null,
    ticket: null,
  }));
  const query = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 10000, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
  function clear(expired = false) {
    if (expired) authDiagnostic("expired", "UNAUTHENTICATED");
    generation++;
    clearTimeout(timer);
    token = null;
    realtime?.close();
    realtime = null;
    void query.cancelQueries();
    query.clear();
    store.setState({
      session: null,
      expired,
      connection: "offline",
      snapshot: null,
      resyncNeeded: false,
      realtimeError: null,
      ticket: null,
    });
  }
  const http = createHttp(
    origin,
    () => token,
    () => clear(true),
    fetcher,
  );
  function authDiagnostic(
    authentication: TelegramDiagnostics["authentication"],
    errorCode: string | null = null,
  ) {
    const current = store.getState().telegramDiagnostics;
    if (current) store.setState({ telegramDiagnostics: { ...current, authentication, errorCode } });
  }
  async function login(commandId: string) {
    authDiagnostic("pending");
    try {
      const epoch = generation;
      const result = await http(
        "/v1/auth/telegram-mini-app",
        issuedSchema,
        { schemaVersion: 1, commandId, initData },
        "POST",
        false,
      );
      if (epoch !== generation) throw new ClientError("UNAUTHENTICATED");
      if (result.session.expiresAt * 1000 <= Date.now()) throw new ClientError("UNAUTHENTICATED");
      clear();
      token = result.accessToken;
      store.setState({ session: result.session, expired: false });
      authDiagnostic("authenticated");
      timer = setTimeout(
        () => clear(true),
        Math.min(2147483647, result.session.expiresAt * 1000 - Date.now()),
      );
      if (scope === "owner-auth") return;
      realtime = realtimeFactory(origin, token, {
        state: (connection) => store.setState({ connection }),
        snapshot: (snapshot) =>
          store.setState({
            snapshot:
              snapshot && store.getState().session
                ? publicSnapshot(snapshot, store.getState().session!.userId)
                : null,
          }),
        resync: (resyncNeeded) => store.setState({ resyncNeeded }),
        expired: () => clear(true),
        error: (realtimeError) => store.setState({ realtimeError }),
      });
    } catch (error) {
      authDiagnostic(
        "failed",
        diagnosticErrorCode(error instanceof ClientError ? error.code : undefined),
      );
      throw error;
    }
  }
  return {
    scope,
    store,
    query,
    http,
    login,
    hasLaunch: () => initData.length > 0,
    async createAccount(commandId: string, displayName: string) {
      authDiagnostic("pending");
      try {
        const epoch = generation;
        const result = await http(
          "/v1/auth/telegram-mini-app/account",
          accountSchema,
          { schemaVersion: 1, commandId, displayName, initData },
          "POST",
          false,
        );
        if (epoch !== generation) throw new ClientError("UNAUTHENTICATED");
        if (scope === "full" && result.startParam && parseRoomStartParam(result.startParam))
          store.setState({ invite: result.startParam });
        authDiagnostic("not-requested");
      } catch (error) {
        authDiagnostic(
          "failed",
          diagnosticErrorCode(error instanceof ClientError ? error.code : undefined),
        );
        throw error;
      }
    },
    async logout() {
      try {
        await http(
          "/v1/auth/logout",
          z.object({ schemaVersion: z.literal(1), ok: z.literal(true) }),
          { schemaVersion: 1 },
        );
      } finally {
        clear();
        initData = "";
        authDiagnostic("signed-out");
        store.setState({ invite: null });
      }
    },
    personal: () => {
      if (scope !== "owner-auth" || !token || !store.getState().session)
        throw new ClientError("UNAUTHENTICATED");
      realtime ??= createRealtime(
        origin,
        token,
        {
          state: (connection) => store.setState({ connection }),
          snapshot: (snapshot) =>
            store.setState({
              snapshot:
                snapshot && store.getState().session
                  ? publicSnapshot(snapshot, store.getState().session!.userId)
                  : null,
            }),
          resync: (resyncNeeded) => store.setState({ resyncNeeded }),
          expired: () => clear(true),
          error: (realtimeError) => store.setState({ realtimeError }),
        },
        undefined,
        true,
      );
      return realtime;
    },
    realtime: () => {
      if (!realtime) throw new ClientError("UNAUTHENTICATED");
      return realtime;
    },
    dispose() {
      clear();
      initData = "";
      store.setState({ invite: null });
    },
  };
}
export type Runtime = ReturnType<typeof createRuntime>;

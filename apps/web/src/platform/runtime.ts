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
export interface State {
  session: Session | null;
  expired: boolean;
  connection: Connection;
  snapshot: Snapshot | null;
  realtimeError: ClientError | null;
  invite: string | null;
  ticket: Ticket | null;
}
export function createRuntime(
  origin: string,
  initialInitData: string,
  fetcher: typeof fetch = fetch,
  realtimeFactory = createRealtime,
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
    session: null,
    expired: false,
    connection: "offline",
    snapshot: null,
    realtimeError: null,
    invite: startParam && parseRoomStartParam(startParam) ? startParam : null,
    ticket: null,
  }));
  const query = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 10000, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
  function clear(expired = false) {
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
  async function login(commandId: string) {
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
    timer = setTimeout(
      () => clear(true),
      Math.min(2147483647, result.session.expiresAt * 1000 - Date.now()),
    );
    realtime = realtimeFactory(origin, token, {
      state: (connection) => store.setState({ connection }),
      snapshot: (snapshot) => store.setState({ snapshot }),
      expired: () => clear(true),
      error: (realtimeError) => store.setState({ realtimeError }),
    });
  }
  return {
    store,
    query,
    http,
    login,
    hasLaunch: () => initData.length > 0,
    async createAccount(commandId: string, displayName: string) {
      const epoch = generation;
      const result = await http(
        "/v1/auth/telegram-mini-app/account",
        accountSchema,
        { schemaVersion: 1, commandId, displayName, initData },
        "POST",
        false,
      );
      if (epoch !== generation) throw new ClientError("UNAUTHENTICATED");
      if (result.startParam && parseRoomStartParam(result.startParam))
        store.setState({ invite: result.startParam });
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
        store.setState({ invite: null });
      }
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

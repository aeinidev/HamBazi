import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { matchAckSchema, okValue, type Snapshot } from "../../../platform/contracts.js";
import type { Runtime } from "../../../platform/runtime.js";
import { ClientError } from "../../../platform/errors.js";
import { commandSchema, type KahrobaCommand } from "../adapters/index.js";

/** Identity captured once, retained across ambiguous failures. Never changes the snapshot. */
export function createKahrobaCommandLifecycle(deps: {
  request(input: unknown): Promise<unknown>;
  sync(): Promise<void>;
  available(): boolean;
  newId(): string;
}) {
  let intent: {
    schemaVersion: 1;
    matchId: string;
    actionId: string;
    expectedVersion: number;
    command: KahrobaCommand;
  } | null = null;
  let running = false,
    generation = 0;
  return {
    get blocked() {
      return running || intent !== null;
    },
    reset() {
      generation++;
      intent = null;
    },
    begin(snapshot: Snapshot, command: unknown) {
      if (
        running ||
        intent ||
        !deps.available() ||
        snapshot.role !== "PLAYER" ||
        snapshot.status !== "ACTIVE"
      )
        throw new ClientError("GAME_STATE_CONFLICT");
      intent = {
        schemaVersion: 1,
        matchId: snapshot.matchId,
        actionId: deps.newId(),
        expectedVersion: snapshot.stateVersion,
        command: commandSchema.parse(command),
      };
    },
    async execute() {
      if (running || !intent) return;
      if (!deps.available()) throw new ClientError("NETWORK_ERROR", true);
      running = true;
      const captured = intent,
        epoch = generation;
      try {
        await deps.request(captured);
        if (epoch === generation) intent = null;
        await deps.sync();
      } catch (error) {
        if (error instanceof ClientError && error.code === "GAME_STATE_CONFLICT") await deps.sync();
        if (epoch === generation && (!(error instanceof ClientError) || !error.retryable))
          intent = null;
        throw error;
      } finally {
        running = false;
      }
    },
  };
}
export function useKahrobaCommands(runtime: Runtime, matchId: string, snapshot: Snapshot | null) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(null),
    [, refresh] = useState(0);
  const sessionId = useStore(runtime.store, (s) => s.session?.sessionId);
  const lifecycle = useMemo(
    () =>
      createKahrobaCommandLifecycle({
        newId: () => crypto.randomUUID(),
        available: () => {
          const s = runtime.store.getState();
          return (
            s.connection === "connected" &&
            !s.resyncNeeded &&
            s.snapshot?.matchId === matchId &&
            s.snapshot.role === "PLAYER"
          );
        },
        request: async (input) =>
          runtime.realtime().request("game:command", input, okValue(matchAckSchema)),
        sync: () => runtime.realtime().sync(),
      }),
    [runtime, matchId],
  );
  useEffect(() => {
    lifecycle.reset();
    setError(null);
    refresh((n) => n + 1);
    return () => lifecycle.reset();
  }, [lifecycle, sessionId]);
  useEffect(() => {
    if (snapshot?.role === "SPECTATOR" || snapshot?.status === "FINISHED") {
      lifecycle.reset();
      setError(null);
      refresh((n) => n + 1);
    }
  }, [lifecycle, snapshot?.role, snapshot?.status]);
  async function execute() {
    setPending(true);
    setError(null);
    try {
      await lifecycle.execute();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
      refresh((n) => n + 1);
    }
  }
  return {
    pending,
    error,
    blocked: pending || lifecycle.blocked,
    retry: () => void execute(),
    send(command: KahrobaCommand) {
      if (!snapshot || lifecycle.blocked) return;
      try {
        lifecycle.begin(snapshot, command);
        void execute();
      } catch (e) {
        setError(e);
      }
    },
  };
}

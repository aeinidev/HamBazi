import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import type { Runtime } from "../platform/runtime.js";
import type { State } from "../platform/runtime.js";
import { ClientError, errorMessage } from "../platform/errors.js";
export const RuntimeContext = createContext<Runtime | null>(null);
export function useRuntime() {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error("Missing runtime");
  return value;
}
export function useSession<T>(selector: (state: State) => T) {
  return useStore(useRuntime().store, selector);
}
export function go(path: string) {
  window.location.hash = path;
}
export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="notice error" role="alert">
      <p>{errorMessage(error)}</p>
      {retry && (
        <button className="secondary" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <p className="notice" role="status">
      Loading…
    </p>
  );
}
export function useTask() {
  const operation = useRef<(() => Promise<void>) | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const running = useRef(false);
  async function execute() {
    if (!operation.current || running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      await operation.current();
      operation.current = null;
    } catch (error) {
      setError(error);
      if (error instanceof ClientError && !error.retryable) operation.current = null;
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  return {
    pending,
    blocked: pending || operation.current !== null,
    error,
    retry: () => {
      void execute();
    },
    run(task: () => Promise<void>) {
      if (operation.current || running.current) return;
      operation.current = task;
      void execute();
    },
    notice: error ? (
      <ErrorNotice
        error={error}
        {...(operation.current
          ? {
              retry: () => {
                void execute();
              },
            }
          : {})}
      />
    ) : null,
  };
}

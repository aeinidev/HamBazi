import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { CoupMatch } from "../../games/coup/index.js";
import { ClientError } from "../../platform/errors.js";
import { okValue, snapshotSchema, matchAckSchema } from "../../platform/contracts.js";
import { Panel, ErrorNotice, useRuntime, useSession, useTask } from "../../ui/shared.js";
const currentSchema = z.strictObject({ schemaVersion: z.literal(1), matchId: z.uuid().nullable() });
export function PersonalGame({
  startIntent,
  onStartConsumed,
}: { startIntent?: string | undefined; onStartConsumed?: (() => void) | undefined } = {}) {
  const runtime = useRuntime(),
    task = useTask("fa"),
    lookup = useTask("fa"),
    connection = useSession((s) => s.connection),
    snapshot = useSession((s) => s.snapshot),
    error = useSession((s) => s.realtimeError);
  const initialIntent = useRef(startIntent);
  const mounted = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    mounted.current = true;
    runtime.personal();
    return () => {
      mounted.current = false;
    };
  }, [runtime]);
  async function open(commandId?: string) {
    const r = await runtime
      .personal()
      .request("personal:current", { schemaVersion: 1 }, okValue(currentSchema));
    if (!mounted.current) return;
    let matchId = r.value.matchId;
    if (!matchId && commandId) {
      if (runtime.store.getState().connection !== "connected")
        throw new ClientError("NETWORK_ERROR", true);
      const started = await runtime
        .personal()
        .request("personal:start", { schemaVersion: 1, commandId }, okValue(snapshotSchema));
      matchId = started.value.matchId;
    }
    if (!mounted.current) return;
    setSelected(matchId);
    if (matchId) await runtime.personal().subscribe(matchId);
    if (!mounted.current) return;
    setChecked(true);
    initialIntent.current = undefined;
    onStartConsumed?.();
  }
  useEffect(() => {
    if (connection !== "connected") return;
    lookup.run(() => open(initialIntent.current));
  }, [runtime, connection]);
  useEffect(() => {
    if (!selected || connection !== "connected") return;
    const timer = setInterval(() => {
      void runtime.personal().sync();
    }, 2000);
    return () => clearInterval(timer);
  }, [runtime, selected, connection]);
  const current = snapshot?.matchId === selected ? snapshot : null;
  function start() {
    const commandId = crypto.randomUUID();
    task.run(() => open(commandId));
  }
  function close() {
    if (!current) return;
    const body = {
      schemaVersion: 1,
      actionId: crypto.randomUUID(),
      matchId: current.matchId,
      expectedVersion: current.stateVersion,
    };
    task.run(async () => {
      await runtime.personal().request("personal:close", body, okValue(matchAckSchema));
      setSelected(null);
      runtime.store.setState({ snapshot: null });
    });
  }
  const blocked = task.blocked || lookup.blocked || connection !== "connected";
  return (
    <section className="midnight-personal-game" aria-label="بازی کودتا با ربات">
      <Panel title="کودتا با ربات">
        <p className="quiet">با بازگشت یا قطع اتصال، بازی ناتمام برای ادامه باقی می‌ماند.</p>
        {error && (
          <ErrorNotice language="fa" error={error} retry={() => runtime.personal().retry()} />
        )}
        {!checked && !lookup.error && !error && <p role="status">در حال آماده‌سازی بازی…</p>}
        {checked &&
        (!current || current.status === "FINISHED" || current.status === "TERMINATED") ? (
          <button disabled={blocked} onClick={start}>
            {task.pending ? "در حال شروع…" : "شروع بازی با ربات"}
          </button>
        ) : current ? null : null}
        {current && (current.status === "ACTIVE" || current.status === "FINISHED") && (
          <div className="existing-coup-table" dir="rtl">
            <CoupMatch snapshot={current} onEnd={close} endBlocked={blocked} />
          </div>
        )}
        {lookup.notice}
        {task.notice}
      </Panel>
    </section>
  );
}

import { useEffect, useState } from "react";
import { z } from "zod";
import { CoupMatch } from "../../games/coup/index.js";
import { okValue, snapshotSchema, matchAckSchema } from "../../platform/contracts.js";
import { Panel, ErrorNotice, useRuntime, useSession, useTask } from "../../ui/shared.js";
const currentSchema = z.strictObject({ schemaVersion: z.literal(1), matchId: z.uuid().nullable() });
export function PersonalGame() {
  const runtime = useRuntime(),
    task = useTask(),
    connection = useSession((s) => s.connection),
    snapshot = useSession((s) => s.snapshot),
    error = useSession((s) => s.realtimeError);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    runtime.personal();
  }, [runtime]);
  useEffect(() => {
    if (connection !== "connected") return;
    let cancelled = false;
    void runtime
      .personal()
      .request("personal:current", { schemaVersion: 1 }, okValue(currentSchema))
      .then((r) => {
        if (!cancelled && r.value.matchId) {
          setSelected(r.value.matchId);
          void runtime.personal().subscribe(r.value.matchId);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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
    const body = { schemaVersion: 1, commandId: crypto.randomUUID() };
    task.run(async () => {
      const r = await runtime.personal().request("personal:start", body, okValue(snapshotSchema));
      setSelected(r.value.matchId);
      await runtime.personal().subscribe(r.value.matchId);
    });
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
  return (
    <Panel title="Personal Coup test">
      <p className="quiet">One server bot. Personal test results do not enter leaderboards.</p>
      {error && <ErrorNotice error={error} retry={() => runtime.personal().retry()} />}
      {!current || current.status === "FINISHED" || current.status === "TERMINATED" ? (
        <button disabled={task.blocked || connection !== "connected"} onClick={start}>
          Start game with bot
        </button>
      ) : (
        <button
          className="secondary"
          disabled={task.blocked || connection !== "connected"}
          onClick={close}
        >
          End personal game
        </button>
      )}
      {current && (current.status === "ACTIVE" || current.status === "FINISHED") && (
        <CoupMatch snapshot={current} />
      )}{" "}
      {task.notice}
    </Panel>
  );
}

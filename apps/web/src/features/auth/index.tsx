import { useState } from "react";
import { Panel, go, useRuntime, useSession, useTask } from "../../ui/shared.js";
export function AuthScreen({ localPreview = false }: { localPreview?: boolean }) {
  const runtime = useRuntime();
  const preview = import.meta.env.DEV && localPreview;
  const expired = useSession((s) => s.expired);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const task = useTask();
  const available = runtime.hasLaunch() && !expired;
  function submit() {
    const commandId = crypto.randomUUID();
    const loginId = crypto.randomUUID();
    const displayName = name;
    const hash = window.location.hash.slice(1);
    const resume = /^\/(rooms|match)\/[0-9a-f-]{36}$/i.test(hash) ? hash : "/games";
    task.run(async () => {
      if (creating) await runtime.createAccount(commandId, displayName);
      await runtime.login(creating ? loginId : commandId);
      go(runtime.store.getState().invite ? "/invite" : resume);
    });
  }
  return (
    <div className="welcome">
      <p className="eyebrow">YOUR NEXT GAME STARTS HERE</p>
      <h1>
        Make room
        <br />
        for a good game.
      </h1>
      <Panel
        title={expired ? "Welcome back" : creating ? "Create your account" : "Welcome to HamBazi"}
      >
        {!available ? (
          <p>
            Open HamBazi from Telegram
            {expired ? " again to renew your session" : " to sign in and play with friends"}.
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <p>
              {creating
                ? "Choose the name other players will see."
                : preview
                  ? "Explore with a synthetic local session."
                  : "Sign in securely with your Telegram account."}
            </p>
            {creating && (
              <label>
                Display name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={256}
                  autoComplete="nickname"
                  dir="auto"
                  disabled={task.blocked}
                />
              </label>
            )}
            <button disabled={task.blocked}>
              {task.pending
                ? "Connecting…"
                : creating
                  ? "Create account & continue"
                  : preview
                    ? "Continue preview"
                    : "Continue with Telegram"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={task.blocked}
              onClick={() => setCreating(!creating)}
            >
              {creating ? "I already have an account" : "New here? Create an account"}
            </button>
          </form>
        )}
        {task.notice}
      </Panel>
      <p className="quiet">One account. A place at the table.</p>
    </div>
  );
}

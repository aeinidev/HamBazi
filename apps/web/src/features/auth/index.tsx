import { useEffect, useRef, useState } from "react";
import { Panel, go, useRuntime, useSession, useTask } from "../../ui/shared.js";
import { HamBaziLoading } from "../../ui/loading.js";
import { TelegramWelcome } from "./telegram-welcome.js";
export function AuthScreen({ localPreview = false }: { localPreview?: boolean }) {
  const runtime = useRuntime();
  const preview = import.meta.env.DEV && localPreview;
  const registrationRequired = useSession((s) => s.registrationRequired);
  const attempted = useRef(false);
  const expired = useSession((s) => s.expired);
  const [creating, setCreating] = useState(false);
  const createIntent = useRef(crypto.randomUUID());
  const loginIntent = useRef(crypto.randomUUID());
  const [name, setName] = useState("");
  const task = useTask(registrationRequired || runtime.scope === "owner-auth" ? "fa" : undefined);
  const available = runtime.hasLaunch() && !expired;
  function submit() {
    const needsName = registrationRequired || creating;
    const displayName = name;
    const hash = window.location.hash.slice(1);
    const resume = /^\/(rooms|match)\/[0-9a-f-]{36}$/i.test(hash) ? hash : "/games";
    task.run(async () => {
      if (needsName) await runtime.createAccount(createIntent.current, displayName);
      await runtime.login(needsName ? loginIntent.current : createIntent.current);
      go(runtime.store.getState().invite ? "/invite" : resume);
    });
  }
  useEffect(() => {
    if (
      (import.meta.env.PROD || runtime.scope === "owner-auth") &&
      !preview &&
      available &&
      !registrationRequired &&
      !attempted.current
    ) {
      attempted.current = true;
      submit();
    }
  }, [runtime, available, preview, task, registrationRequired]);
  if (
    (import.meta.env.PROD || runtime.scope === "owner-auth") &&
    !preview &&
    available &&
    !registrationRequired &&
    !creating &&
    !task.error
  )
    return <HamBaziLoading />;
  if (registrationRequired)
    return (
      <div className="welcome" lang="fa" dir="rtl">
        <Panel title="ثبت‌نام در هم‌بازی">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label>
              دوست داری با چه اسمی در بازی دیده بشی؟
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={256}
                dir="auto"
                autoComplete="nickname"
                disabled={task.blocked}
              />
            </label>
            <button disabled={task.blocked}>
              {task.pending ? "در حال ثبت‌نام…" : "ثبت نام و ادامه"}
            </button>
          </form>
          {task.notice}
        </Panel>
      </div>
    );
  if (runtime.scope === "owner-auth" && !available)
    return <TelegramWelcome expired={expired}>{task.notice}</TelegramWelcome>;
  if (runtime.scope === "owner-auth")
    return (
      <div className="welcome" lang="fa" dir="rtl">
        <Panel title="ورود به هم‌بازی">
          <p role="status">{task.pending ? "در حال ورود…" : "با حساب تلگرام خودت وارد شو."}</p>
          <button disabled={task.blocked} onClick={submit}>
            {task.pending ? "در حال ورود…" : "ورود با تلگرام"}
          </button>
          {task.notice}
        </Panel>
      </div>
    );
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
            {preview && (
              <button
                type="button"
                className="text-button"
                disabled={task.blocked}
                onClick={() => setCreating(!creating)}
              >
                {creating ? "I already have an account" : "New here? Create an account"}
              </button>
            )}
          </form>
        )}
        {task.notice}
      </Panel>
      <p className="quiet">One account. A place at the table.</p>
    </div>
  );
}

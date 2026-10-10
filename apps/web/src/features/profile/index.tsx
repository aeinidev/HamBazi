import { OwnStatistics } from "../leaderboard/index.js";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { profileAckSchema, profileSchema, type Profile } from "../../platform/contracts.js";
import { ErrorNotice, Loading, Panel, useRuntime, useTask } from "../../ui/shared.js";
function Editor({ profile, persian = false }: { profile: Profile; persian?: boolean }) {
  const runtime = useRuntime();
  const task = useTask(persian ? "fa" : undefined);
  const [name, setName] = useState(profile.displayName);
  const [theme, setTheme] = useState(profile.settings.theme);
  const [locale, setLocale] = useState(profile.settings.locale);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const body = {
          schemaVersion: 1,
          commandId: crypto.randomUUID(),
          expectedVersion: profile.version,
          patch: { displayName: name, settings: { theme, locale } },
        };
        task.run(async () => {
          await runtime.http("/v1/me", profileAckSchema, body, "PATCH");
          await runtime.query.invalidateQueries({ queryKey: ["profile"] });
        });
      }}
    >
      <p className="handle" dir="ltr">
        @{profile.publicHandle}
      </p>
      <label>
        {persian ? "نام نمایشی" : "Display name"}
        <input
          dir="auto"
          value={name}
          maxLength={256}
          required
          disabled={task.blocked}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        {persian ? "ظاهر" : "Appearance"}
        <select
          value={theme}
          disabled={task.blocked}
          onChange={(e) => setTheme(e.target.value as typeof theme)}
        >
          <option value="system">
            {persian ? "مطابق تلگرام / سیستم" : "Follow Telegram / system"}
          </option>
          <option value="light">{persian ? "روشن" : "Light"}</option>
          <option value="dark">{persian ? "تیره" : "Dark"}</option>
        </select>
      </label>
      <label>
        {persian ? "زبان" : "Language preference"}
        <select
          value={locale}
          disabled={task.blocked}
          onChange={(e) => setLocale(e.target.value as typeof locale)}
        >
          <option value="auto">{persian ? "خودکار" : "Automatic"}</option>
          <option value="fa">فارسی</option>
          <option value="en">English</option>
        </select>
      </label>
      <button disabled={task.blocked}>
        {persian
          ? task.pending
            ? "در حال ذخیره…"
            : "ذخیرهٔ تغییرات"
          : task.pending
            ? "Saving…"
            : "Save changes"}
      </button>
      {task.notice}
    </form>
  );
}
/** Reuses the existing profile editor; no statistics or unrelated product requests. */
export function SettingsScreen() {
  const runtime = useRuntime();
  const task = useTask("fa");
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: ({ signal }) => runtime.http("/v1/me", profileSchema, undefined, "GET", true, signal),
  });
  useEffect(() => {
    if (profile.data) document.documentElement.dataset.theme = profile.data.settings.theme;
  }, [profile.data]);
  return (
    <section className="midnight-settings" aria-labelledby="settings-heading">
      <h1 id="settings-heading">تنظیمات</h1>
      <Panel title="حساب و تنظیمات">
        {profile.isPending ? (
          <p role="status">در حال بارگذاری…</p>
        ) : profile.error ? (
          <ErrorNotice
            language="fa"
            error={profile.error}
            retry={() => {
              void profile.refetch();
            }}
          />
        ) : (
          <Editor key={profile.data.version} profile={profile.data} persian />
        )}
      </Panel>
      <button
        className="secondary"
        disabled={task.blocked}
        onClick={() => task.run(() => runtime.logout())}
      >
        خروج از حساب
      </button>
      {task.notice}
    </section>
  );
}
export function ProfileScreen() {
  const runtime = useRuntime();
  const task = useTask();
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: ({ signal }) => runtime.http("/v1/me", profileSchema, undefined, "GET", true, signal),
  });
  useEffect(() => {
    if (profile.data) document.documentElement.dataset.theme = profile.data.settings.theme;
  }, [profile.data]);
  return (
    <>
      <h1>Your profile</h1>
      <Panel title="At the table">
        {profile.isPending ? (
          <Loading />
        ) : profile.error ? (
          <ErrorNotice
            error={profile.error}
            retry={() => {
              void profile.refetch();
            }}
          />
        ) : (
          <Editor key={profile.data.version} profile={profile.data} />
        )}
        <button
          className="text-button"
          onClick={() => {
            void profile.refetch();
          }}
        >
          Reload profile
        </button>
      </Panel>
      <OwnStatistics />
      <button
        className="secondary"
        onClick={() => task.run(() => runtime.logout())}
        disabled={task.blocked}
      >
        Sign out
      </button>
      {task.notice}
    </>
  );
}

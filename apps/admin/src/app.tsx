import { GameManagement } from "./features/game-management/index.js";
import { UserDetail } from "./features/users/index.js";
import { ManagementPanel, ResourceActions } from "./features/management/index.js";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  adminAccessSchema,
  adminAuditPageSchema,
  adminLoginResultSchema,
  adminOverviewSchema,
  adminPageSchema,
  adminManagementMetaSchema,
} from "@hambazi/validation";
import type { z } from "zod";
import { AdminClientError, adminRequest } from "./platform/http.js";

type Access = z.infer<typeof adminAccessSchema>;
const sections = [
  ["admins", "مدیران و نقش‌ها", "admins.view"],
  ["operations", "درخواست‌ها و تأییدها", "SESSION"],
  ["overview", "نمای کلی", "overview.view"],
  ["users", "کاربران", "users.view"],
  ["games", "بازی‌ها", "games.view"],
  ["rooms", "اتاق‌ها", "rooms.view"],
  ["matches", "مسابقات", "matches.view"],
  ["monitoring/summary", "مانیتورینگ", "monitoring.view"],
  ["audit-events", "رویدادهای امنیتی", "audit.view"],
] as const;
const errorMessage = (error: unknown) =>
  error instanceof AdminClientError && error.code === "RATE_LIMITED"
    ? "تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید."
    : error instanceof AdminClientError && error.code === "FORBIDDEN"
      ? "به این بخش دسترسی ندارید."
      : "درخواست تأیید نشد. اطلاعات ورود یا دسترسی خود را بررسی کنید.";
const metricTitles: Record<string, string> = {
  matches_created: "مسابقات ایجادشده",
  matches_waiting: "مسابقات منتظر بازیکن",
  matches_ready: "مسابقات آماده",
  matches_starting: "مسابقات در حال شروع",
  matches_active: "مسابقات فعال",
  matches_started: "مسابقات شروع‌شده",
  matches_finished: "مسابقات پایان‌یافته",
  matches_terminated: "مسابقات متوقف‌شده",
  players_disconnected: "بازیکنان قطع‌شده",
  players_bot: "صندلی‌های جایگزین‌شده با ربات",
  disconnects_recorded: "قطع اتصال‌های ثبت‌شده",
  reconnects_recorded: "اتصال مجدد ثبت‌شده",
  bot_takeovers_recorded: "جایگزینی ربات ثبت‌شده",
  rooms_waiting: "اتاق‌های منتظر",
  rooms_full: "اتاق‌های پُر",
  rooms_starting: "اتاق‌های در حال شروع",
  rooms_started: "اتاق‌های شروع‌شده",
  rooms_closed: "اتاق‌های بسته",
  rooms_expired: "اتاق‌های منقضی",
  outbox_pending: "رویدادهای منتظر ارسال",
  outbox_failed: "رویدادهای ناموفق",
  outbox_oldest_pending_seconds: "سن قدیمی‌ترین ارسال در صف (ثانیه)",
  matches_unavailable: "وضعیت مسابقات",
  rooms_unavailable: "وضعیت اتاق‌ها",
  outbox_unavailable: "وضعیت ارسال رویدادها",
};
const sourceTitles: Record<string, string> = {
  matches: "مسابقات",
  rooms: "اتاق‌ها",
  outbox: "ارسال رویدادها",
};
const statusTitles: Record<string, string> = {
  ACTIVE: "فعال",
  BANNED: "محروم",
  DISABLED: "غیرفعال",
  MAINTENANCE: "در دست نگه‌داری",
  WAITING: "منتظر",
  FULL: "پُر",
  STARTING: "در حال شروع",
  STARTED: "شروع‌شده",
  CLOSED: "بسته",
  EXPIRED: "منقضی",
  CREATED: "ایجادشده",
  WAITING_FOR_PLAYERS: "منتظر بازیکنان",
  READY: "آماده",
  FINISHED: "پایان‌یافته",
  TERMINATED: "متوقف‌شده",
};

export function AdminApp() {
  const cache = useQueryClient();
  const [access, setAccess] = useState<Access | null>(null);
  const [mode, setMode] = useState<"CHECKING" | "LOGIN" | "PIN" | "DASHBOARD">("CHECKING");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [csrf, setCsrf] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState("overview");
  const [userSearch, setUserSearch] = useState(""),
    [userStatus, setUserStatus] = useState("");
  const [userFilters, setUserFilters] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [security, setSecurity] = useState(false);
  const [managementEnabled, setManagementEnabled] = useState(false);
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const accessRevision = useRef("");
  const accessRequest = useRef(0);
  const verifiedAt = useRef(0);
  const [resourceRevision, setResourceRevision] = useState(0);
  const retry = useRef<{ fingerprint: string; commandId: string } | null>(null);
  const reset = useCallback(() => {
    generation.current++;
    accessRevision.current = "";
    accessRequest.current++;
    setAccess(null);
    setData(null);
    setPassword("");
    setPin("");
    setCsrf("");
    setMode("LOGIN");
    cache.clear();
    retry.current = null;
    setSecurity(false);
    setManagementEnabled(false);
    setUserSearch("");
    setUserStatus("");
    setUserFilters("");
    setDetail(null);
    setCursor(null);
  }, [cache]);
  const inspect = useCallback(
    async (signal?: AbortSignal) => {
      const epoch = generation.current,
        request = ++accessRequest.current;
      let value: Access;
      try {
        value = adminAccessSchema.parse(
          await adminRequest("me/access", undefined, undefined, signal),
        );
      } catch (error) {
        if (epoch !== generation.current || request !== accessRequest.current || signal?.aborted)
          return;
        throw error;
      }
      if (epoch !== generation.current || request !== accessRequest.current) return;
      verifiedAt.current = performance.now();
      const revision = `${value.authorizationVersion}:${value.policyRevision}`;
      if (accessRevision.current && revision !== accessRevision.current) {
        generation.current++;
        setData(null);
        cache.clear();
      }
      accessRevision.current = revision;
      setAccess(value);
      setCsrf(value.csrfToken);
      setMode("DASHBOARD");
    },
    [cache],
  );
  useEffect(() => {
    const controller = new AbortController();
    void inspect(controller.signal).catch(() => {
      if (!controller.signal.aborted) reset();
    });
    return () => controller.abort();
  }, [inspect, reset]);
  useEffect(() => {
    if (mode !== "DASHBOARD") return;
    const controller = new AbortController(),
      epoch = generation.current;
    void adminRequest("management/meta", undefined, undefined, controller.signal)
      .then((raw) => {
        if (!controller.signal.aborted && epoch === generation.current)
          setManagementEnabled(adminManagementMetaSchema.parse(raw).enabled);
      })
      .catch(() => {
        if (!controller.signal.aborted) setManagementEnabled(false);
      });
    return () => controller.abort();
  }, [mode]);
  useEffect(() => {
    if (mode !== "DASHBOARD") return;
    let outstanding = false;
    const controller = new AbortController();
    const check = async () => {
      if (document.hidden) return;
      if (performance.now() - verifiedAt.current >= 5000) {
        reset();
        return;
      }
      if (outstanding) return;
      outstanding = true;
      try {
        await inspect(controller.signal);
      } catch {
        if (!controller.signal.aborted) reset();
      } finally {
        outstanding = false;
      }
    };
    const timer = setInterval(() => {
      void check();
    }, 2500);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", check);
    };
  }, [mode, inspect, reset]);
  useEffect(() => {
    if (mode !== "DASHBOARD" || !access) return;
    const timer = setTimeout(
      () => {
        if (!document.hidden) reset();
      },
      Math.max(0, 5000 - (performance.now() - verifiedAt.current)),
    );
    return () => clearTimeout(timer);
  }, [access, mode, reset]);
  const allowed = sections.filter((s) =>
    (s[0] === "admins" || s[0] === "operations") && !managementEnabled
      ? false
      : s[2] === "SESSION"
        ? access?.permissions.some((p) => /\.(create|edit|manage|approve)$/.test(p))
        : access?.permissions.includes(s[2]),
  );
  const permitted = allowed.some((s) => s[0] === section);
  useEffect(() => {
    if (mode !== "DASHBOARD" || !access) return;
    if (!permitted) {
      setData(null);
      setSection(allowed[0]?.[0] ?? "");
      return;
    }
    if (["admins", "operations", "games", "rooms", "matches"].includes(section)) {
      setData(null);
      setLoading(false);
      return;
    }
    const epoch = generation.current,
      controller = new AbortController();
    setData(null);
    setLoading(true);
    setError("");
    void adminRequest(
      (section === "users" && !detail && userFilters ? "users/search" : section) +
        (detail
          ? `/${encodeURIComponent(detail)}`
          : cursor
            ? `?cursor=${encodeURIComponent(cursor)}`
            : "") +
        (section === "users" && !detail && userFilters
          ? `${cursor ? "&" : "?"}${userFilters}`
          : ""),
      undefined,
      undefined,
      controller.signal,
    )
      .then((raw) => {
        const parsed =
          section === "overview" || section === "monitoring/summary"
            ? adminOverviewSchema.parse(raw)
            : section === "audit-events"
              ? adminAuditPageSchema.parse(raw)
              : adminPageSchema.parse(raw);
        if (generation.current === epoch && !controller.signal.aborted) setData(parsed);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    mode,
    section,
    cursor,
    userFilters,
    detail,
    permitted,
    access?.authorizationVersion,
    access?.policyRevision,
    resourceRevision,
  ]);
  async function refreshed() {
    await inspect();
    setResourceRevision((v) => v + 1);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const epoch = generation.current;
    try {
      const payload = mode === "PIN" ? { pin } : { username, password };
      const fingerprint = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify([mode, payload])),
          ),
        ),
      )
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      if (retry.current?.fingerprint !== fingerprint)
        retry.current = { fingerprint, commandId: crypto.randomUUID() };
      const result = adminLoginResultSchema.parse(
        await adminRequest(
          mode === "PIN" ? "auth/pin" : "auth/login",
          { schemaVersion: 1, commandId: retry.current.commandId, ...payload },
          csrf,
        ),
      );
      retry.current = null;
      if (generation.current !== epoch) return;
      setCsrf(result.csrfToken);
      if (result.next === "PIN_REQUIRED") setMode("PIN");
      else await inspect();
    } catch (e) {
      if (e instanceof AdminClientError) retry.current = null;
      if (generation.current === epoch) setError(errorMessage(e));
    } finally {
      setPassword("");
      setPin("");
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await adminRequest("auth/logout", { schemaVersion: 1, commandId: crypto.randomUUID() }, csrf);
      reset();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (mode === "CHECKING")
    return (
      <main className="login">
        <p role="status">در حال بررسی نشست…</p>
      </main>
    );
  if (mode !== "DASHBOARD")
    return (
      <main className="login">
        <section className="login-card" aria-labelledby="login-title">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              هـ
            </span>
            <span>
              هم‌بازی <small>پنل مدیریت</small>
            </span>
          </div>
          <span className="eyebrow">ورود مدیران</span>
          <h1 id="login-title">{mode === "PIN" ? "رمز امنیتی مالک" : "به هم‌بازی خوش آمدید"}</h1>
          <p className="muted">
            {mode === "PIN"
              ? "برای تکمیل ورود، PIN شش‌رقمی خود را وارد کنید."
              : "با اطلاعات حساب مدیریتی خود وارد شوید."}
          </p>
          <form onSubmit={submit}>
            {mode === "LOGIN" ? (
              <>
                <label>
                  نام کاربری
                  <input
                    autoComplete="username"
                    dir="ltr"
                    value={username}
                    required
                    maxLength={64}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
                <label>
                  رمز عبور
                  <input
                    type="password"
                    dir="ltr"
                    autoComplete="current-password"
                    value={password}
                    required
                    minLength={12}
                    maxLength={256}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <label>
                PIN شش‌رقمی
                <input
                  className="pin"
                  type="password"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pin}
                  required
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "در حال بررسی…" : mode === "PIN" ? "تأیید و ورود" : "ورود به پنل"}
            </button>
          </form>
          {mode === "PIN" && (
            <button className="text-button" disabled={busy} onClick={reset}>
              بازگشت به ورود
            </button>
          )}
          <p className="footnote">دسترسی فقط برای مدیران مجاز هم‌بازی</p>
        </section>
      </main>
    );
  const resourcePage = adminPageSchema.safeParse(data);
  const resource = resourcePage.success
    ? resourcePage.data.items.find((row) => row.id === detail)
    : undefined;
  return (
    <div className="dashboard">
      <aside>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            هـ
          </span>
          <span>
            هم‌بازی <small>مدیریت پلتفرم</small>
          </span>
        </div>
        <nav aria-label="بخش‌های پنل">
          {allowed.map(([path, title]) => (
            <button
              key={path}
              aria-current={!security && section === path ? "page" : undefined}
              onClick={() => {
                setSecurity(false);
                setDetail(null);
                setCursor(null);
                setSection(path);
              }}
            >
              {title}
            </button>
          ))}
        </nav>
        <div className="identity">
          <span>{access?.isOwner ? "مالک اصلی · OWNER" : "مدیر پلتفرم"}</span>
          {access?.isOwner && <button onClick={() => setSecurity(true)}>امنیت حساب مالک</button>}
          <button
            disabled={busy}
            onClick={() => {
              void logout();
            }}
          >
            خروج امن
          </button>
        </div>
      </aside>
      <main className="content">
        <header>
          <div>
            <span className="eyebrow">HAMBAZI / ADMIN</span>
            <h1>{allowed.find((s) => s[0] === section)?.[1] ?? "دسترسی مدیریتی"}</h1>
          </div>
          <span className="status">مدیریت امن</span>
        </header>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {security && access?.isOwner ? (
          <OwnerSecuritySettings csrf={csrf} completed={reset} />
        ) : (section === "admins" || section === "operations") && access ? (
          <ManagementPanel
            key={`${section}:${access.authorizationVersion}:${access.isOwner ? "owner" : access.policyRevision}`}
            kind={section}
            csrf={csrf}
            isOwner={access.isOwner}
            permissions={access.permissions}
            refreshed={refreshed}
          />
        ) : (section === "games" || section === "rooms" || section === "matches") &&
          access &&
          permitted ? (
          <GameManagement
            key={`${section}:${access.authorizationVersion}:${access.policyRevision}:${access.isOwner}:${access.permissions.join(",")}`}
            kind={section}
            csrf={csrf}
            isOwner={access.isOwner}
            permissions={access.permissions}
            managementEnabled={managementEnabled}
            resourceRevision={resourceRevision}
            refreshed={inspect}
          />
        ) : loading ? (
          <p role="status">در حال دریافت اطلاعات…</p>
        ) : !permitted ? (
          <p className="empty">بخشی برای این حساب فعال نشده است.</p>
        ) : (
          <>
            {detail && <button onClick={() => setDetail(null)}>بازگشت به فهرست</button>}
            {section === "users" && !detail && (
              <form
                className="table-panel user-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  const q = new URLSearchParams();
                  if (userSearch.trim()) q.set("search", userSearch.trim());
                  if (userStatus) q.set("status", userStatus);
                  setCursor(null);
                  setUserFilters(q.toString());
                }}
              >
                <label>
                  جستجوی کاربر
                  <input
                    maxLength={64}
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="نام، شناسهٔ عمومی یا UUID"
                  />
                </label>
                <label>
                  وضعیت کاربر
                  <select value={userStatus} onChange={(e) => setUserStatus(e.target.value)}>
                    <option value="">همه</option>
                    <option value="ACTIVE">فعال</option>
                    <option value="BANNED">محروم</option>
                  </select>
                </label>
                <button>اعمال فیلتر</button>
              </form>
            )}
            <ReadPanel
              data={data}
              next={setCursor}
              inspect={(id) => {
                if (id === detail) return;
                setLoading(true);
                setData(null);
                setDetail(id);
              }}
            />
            {section === "users" && detail && access && resource && (
              <UserDetail
                key={`${detail}:${access.authorizationVersion}:${access.policyRevision}`}
                id={detail}
                csrf={csrf}
                isOwner={access.isOwner}
                permissions={access.permissions}
                refreshed={inspect}
                reload={() => setResourceRevision((v) => v + 1)}
              />
            )}
            {managementEnabled && detail && access && resource && (
              <ResourceActions
                key={`${detail}:${access.authorizationVersion}:${access.policyRevision}}`}
                kind={section}
                row={resource}
                csrf={csrf}
                isOwner={access.isOwner}
                permissions={access.permissions}
                refreshed={inspect}
                reload={() => setResourceRevision((v) => v + 1)}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
function ReadPanel({
  data,
  next,
  inspect,
}: {
  data: unknown;
  next(cursor: string): void;
  inspect(id: string): void;
}) {
  const overview = adminOverviewSchema.safeParse(data);
  if (overview.success)
    return (
      <>
        <p className="muted">
          زمان نمونه‌برداری:{" "}
          <time dateTime={overview.data.asOf}>
            {new Date(overview.data.asOf).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })} ·
            تهران
          </time>
        </p>
        <div className="metrics">
          {overview.data.metrics.map((m) => (
            <article key={m.key}>
              <span className="metric-label">{metricTitles[m.key] ?? "شاخص عملیاتی"}</span>
              <strong>
                {m.valid && m.value !== null
                  ? Number(m.value).toLocaleString("fa-IR", { maximumFractionDigits: 2 })
                  : "داده موجود نیست"}
              </strong>
              <small>{sourceTitles[m.source] ?? "سامانه"}</small>
            </article>
          ))}
        </div>
      </>
    );
  const page = adminPageSchema.safeParse(data);
  if (page.success)
    return (
      <section className="table-panel">
        {page.data.items.length === 0 ? (
          <p className="empty">موردی یافت نشد.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>شناسه</th>
                  <th>عنوان</th>
                  <th>وضعیت</th>
                  <th>نسخه و نسخه‌های ثابت اجرا</th>
                </tr>
              </thead>
              <tbody>
                {page.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <button onClick={() => inspect(row.id)}>
                        <bdi>{row.id}</bdi>
                      </button>
                    </td>
                    <td>{row.label}</td>
                    <td>{statusTitles[row.status] ?? row.status}</td>
                    <td>
                      {row.version ?? "—"}
                      {row.pins && (
                        <small>
                          <bdi>
                            {row.pins.engineVersion} / {row.pins.stateSchemaVersion} /{" "}
                            {row.pins.rulesetVersion}
                          </bdi>
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page.data.nextCursor && (
          <button className="text-button" onClick={() => next(page.data.nextCursor!)}>
            صفحهٔ بعد
          </button>
        )}
      </section>
    );
  const audit = adminAuditPageSchema.safeParse(data);
  if (audit.success)
    return (
      <section className="table-panel">
        <h2>آخرین رویدادهای امنیتی</h2>
        {audit.data.items.length === 0 ? (
          <p className="empty">رویدادی ثبت نشده است.</p>
        ) : (
          <ul className="events">
            {audit.data.items.map((row) => (
              <li key={row.id}>
                <bdi>{row.event}</bdi>
                <time dateTime={row.occurredAt}>
                  {new Date(row.occurredAt).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  return <p className="empty">دادهٔ قابل نمایش موجود نیست.</p>;
}
function OwnerSecuritySettings({ csrf, completed }: { csrf: string; completed(): void }) {
  const [kind, setKind] = useState<"password" | "pin">("password");
  const [password, setPassword] = useState(""),
    [currentPin, setCurrentPin] = useState(""),
    [next, setNext] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function change(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (next !== confirmation) {
      setError("مقدار جدید و تکرار آن یکسان نیستند.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await adminRequest(
        `auth/${kind}/change`,
        {
          schemaVersion: 1,
          commandId: crypto.randomUUID(),
          password,
          currentPin,
          ...(kind === "pin" ? { newPin: next } : { newPassword: next }),
        },
        csrf,
      );
      completed();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPassword("");
      setCurrentPin("");
      setNext("");
      setConfirmation("");
      setBusy(false);
    }
  }
  return (
    <section className="login-card">
      <h2>امنیت حساب مالک</h2>
      <div role="group" aria-label="نوع تغییر اطلاعات امنیتی">
        {(["password", "pin"] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setPassword("");
              setCurrentPin("");
              setNext("");
              setConfirmation("");
              setError("");
            }}
          >
            {value === "password" ? "تغییر رمز عبور" : "تغییر PIN"}
          </button>
        ))}
      </div>
      <p className="muted">
        پس از تغییر، تمام نشست‌ها بسته می‌شوند. سه PIN فعلی اشتباه، ورود مالک را تا بازیابی خصوصی
        قفل می‌کند.
      </p>
      <form onSubmit={change}>
        <label>
          رمز عبور فعلی
          <input
            type="password"
            dir="ltr"
            autoComplete="current-password"
            required
            minLength={12}
            maxLength={256}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          PIN فعلی
          <input
            type="password"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            required
            pattern="[0-9]{6}"
            maxLength={6}
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
          />
        </label>
        <label>
          {kind === "pin" ? "PIN جدید" : "رمز عبور جدید"}
          <input
            type="password"
            dir="ltr"
            inputMode={kind === "pin" ? "numeric" : "text"}
            autoComplete={kind === "pin" ? "off" : "new-password"}
            required
            pattern={kind === "pin" ? "[0-9]{6}" : undefined}
            minLength={kind === "pin" ? 6 : 12}
            maxLength={kind === "pin" ? 6 : 256}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label>
          {kind === "pin" ? "تکرار PIN جدید" : "تکرار رمز عبور جدید"}
          <input
            type="password"
            dir="ltr"
            required
            inputMode={kind === "pin" ? "numeric" : "text"}
            autoComplete={kind === "pin" ? "off" : "new-password"}
            pattern={kind === "pin" ? "[0-9]{6}" : undefined}
            minLength={kind === "pin" ? 6 : 12}
            maxLength={kind === "pin" ? 6 : 256}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "در حال بررسی…" : "تأیید تغییر و بستن نشست‌ها"}
        </button>
      </form>
    </section>
  );
}

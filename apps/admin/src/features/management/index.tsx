import { useEffect, useState, type FormEvent } from "react";
import {
  adminActivitySchema,
  adminManagementMetaSchema,
  adminCommandPageSchema,
  adminCommandResultSchema,
  adminDirectorySchema,
  adminSessionPageSchema,
  adminLoginResultSchema,
  adminPermissionSchema,
  type AdminAction,
} from "@hambazi/validation";
import type { z } from "zod";
import { adminRequest } from "../../platform/http.js";

type Directory = z.infer<typeof adminDirectorySchema>;
type Command = z.infer<typeof adminCommandResultSchema>;
type Grant = Directory["operators"][number]["grants"][number];
interface Props {
  csrf: string;
  isOwner: boolean;
  permissions: string[];
  refreshed(): Promise<void>;
}
export const operationTitles: Record<AdminAction["operation"], string> = {
  ADMIN_CREATE: "ساخت مدیر",
  ADMIN_STATUS: "تغییر وضعیت مدیر",
  ADMIN_RESET_PASSWORD: "صدور رمز جدید مدیر",
  ADMIN_ACCESS: "تغییر دسترسی مدیر",
  ADMIN_REVOKE_SESSIONS: "ابطال نشست‌های مدیر",
  ROLE_SAVE: "ذخیرهٔ نقش",
  ROLE_DELETE: "حذف نقش",
  USER_DISPLAY_NAME: "اصلاح نام نمایشی",
  USER_RESTRICT: "محروم‌سازی کاربر",
  USER_UNRESTRICT: "رفع محرومیت کاربر",
  USER_STATUS: "محروم‌سازی یا رفع محرومیت",
  GAME_AVAILABILITY: "پذیرش بازی‌های جدید",
  ROOM_CLOSE: "بستن اتاق پیش از شروع",
  MATCH_TERMINATE: "توقف مسابقه بدون نتیجه",
};
const stateTitles: Record<string, string> = {
  PENDING: "منتظر تأیید",
  APPROVED: "تأییدشده؛ آمادهٔ اجرا",
  SUCCEEDED: "انجام شد",
  FAILED: "عملیات انجام نشد",
  UNKNOWN: "نتیجه نامعلوم؛ بررسی یا تلاش مجدد همین درخواست لازم است",
};
const failure = "درخواست پذیرفته نشد؛ دسترسی، نسخه یا مهلت تأیید را بررسی و اطلاعات را تازه کنید.";

export function OperationFlow({
  action,
  existing,
  completed,
  ...props
}: Props & { action?: AdminAction; existing?: Command; completed(): void }) {
  const [command, setCommand] = useState<Command | null>(existing ?? null),
    [reason, setReason] = useState(
      action?.operation === "USER_RESTRICT"
        ? "ABUSE"
        : action?.operation === "USER_UNRESTRICT"
          ? "APPEAL"
          : "MAINTENANCE",
    );
  const [privateNote, setPrivateNote] = useState("");
  const [password, setPassword] = useState(""),
    [pin, setPin] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [csrf, setCsrf] = useState(props.csrf);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [secret, setSecret] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    setCsrf(props.csrf);
  }, [props.csrf]);
  useEffect(() => {
    if (!secret) return;
    const timer = setTimeout(() => setSecret(""), 60000);
    return () => clearTimeout(timer);
  }, [secret]);
  async function run(
    kind: "request" | "approve" | "execute" | "refresh" | "renew",
    event?: FormEvent,
  ) {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSecret("");
    try {
      if (kind === "request")
        setCommand(
          adminCommandResultSchema.parse(
            await adminRequest(
              "operations",
              {
                schemaVersion: 1,
                commandId: requestId,
                action,
                reasonCode: reason,
                ...(privateNote.trim() ? { privateNote: privateNote.trim() } : {}),
              },
              csrf,
            ),
          ),
        );
      else if (command && kind === "approve") {
        const auth = adminLoginResultSchema.parse(
          await adminRequest(
            `operations/${command.commandId}/approve`,
            {
              schemaVersion: 1,
              commandId: crypto.randomUUID(),
              password,
              ...(props.isOwner ? { pin } : {}),
              confirmed,
            },
            csrf,
          ),
        );
        setCsrf(auth.csrfToken);
        await props.refreshed();
        setCommand(
          adminCommandResultSchema.parse(await adminRequest(`operations/${command.commandId}`)),
        );
      } else if (command) {
        const value = adminCommandResultSchema.parse(
          await adminRequest(
            `operations/${command.commandId}${kind === "execute" ? "/execute" : kind === "renew" ? "/renew" : ""}`,
            kind === "execute" || kind === "renew"
              ? { schemaVersion: 1, commandId: command.commandId }
              : undefined,
            csrf,
          ),
        );
        const { generatedPassword, ...safe } = value;
        setCommand(safe);
        setSecret(generatedPassword ?? "");
      }
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
      setPrivateNote("");
      setPassword("");
      setPin("");
      setConfirmed(false);
    }
  }
  const intent = command?.action ?? action;
  const disabled = intent?.operation === "USER_STATUS";
  return (
    <section className="table-panel operation" aria-label="تأیید عملیات مدیریتی">
      <h2>{intent ? operationTitles[intent.operation] : "عملیات مدیریتی"}</h2>
      {disabled && (
        <p role="alert">
          این درخواست فقط قابل مشاهده است؛ برای اجرا از فرمان‌های جدید محرومیت و رفع محرومیت استفاده
          کنید.
        </p>
      )}
      {intent && (
        <>
          <p>
            شناسهٔ هدف: <bdi>{intent.targetId}</bdi> · نسخهٔ مورد انتظار: {intent.expectedVersion}
          </p>
          {"username" in intent && (
            <p>
              نام کاربری: <bdi>{intent.username}</bdi>
            </p>
          )}
          {"name" in intent && <p>نام نقش: {intent.name}</p>}
          {"expectedMemberCount" in intent && (
            <p>این تغییر بر دسترسی {intent.expectedMemberCount} مدیرِ عضو نقش اثر دارد.</p>
          )}
          {"status" in intent && (
            <p>
              وضعیت درخواستی: <bdi>{intent.status}</bdi>
            </p>
          )}
          {"duration" in intent && (
            <p>
              مدت محرومیت:{" "}
              {
                {
                  HOUR_1: "۱ ساعت",
                  HOURS_24: "۲۴ ساعت",
                  DAYS_7: "۷ روز",
                  DAYS_30: "۳۰ روز",
                  PERMANENT: "دائم",
                }[intent.duration]
              }
              ؛ شروع از لحظهٔ اجرای موفق.
            </p>
          )}
          {(intent.operation === "USER_RESTRICT" || intent.operation === "USER_UNRESTRICT") && (
            <p>نشست‌های قبلی کاربر نامعتبر می‌شوند. نتیجه و وضعیت مسابقهٔ فعال تغییر نمی‌کند.</p>
          )}
          {"displayName" in intent && <p>نام جدید: {intent.displayName}</p>}
          {"grants" in intent && (
            <>
              <p>مجوزهای دقیق این درخواست:</p>
              <ul>
                {intent.grants.map((g, i) => (
                  <li key={i}>
                    <bdi>{g.permission}</bdi> · {g.deny ? "منع" : "اجازه"} ·{" "}
                    {g.gameIds?.join("، ") ?? "همهٔ بازی‌ها"} · <bdi>{g.environment}</bdi>
                  </li>
                ))}
              </ul>
            </>
          )}
          {"roleIds" in intent && (
            <p>
              شناسهٔ نقش‌ها:{" "}
              {intent.roleIds.map((id) => (
                <bdi key={id}>{id} </bdi>
              ))}
            </p>
          )}
          {intent.operation === "MATCH_TERMINATE" && (
            <p className="error">
              این توقف قابل Undo نیست؛ برنده، نتیجه یا امتیاز ساختگی تولید نمی‌شود.
            </p>
          )}
          {intent.operation === "ROOM_CLOSE" && (
            <p>فقط اتاقی که هنوز شروع نشده بسته می‌شود. تاریخچه حذف نمی‌شود.</p>
          )}
        </>
      )}
      {disabled ? null : !command ? (
        <form
          onSubmit={(e) => {
            void run("request", e);
          }}
        >
          <label>
            دلیل عملیات
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {intent?.operation === "USER_RESTRICT" || intent?.operation === "USER_UNRESTRICT" ? (
                <>
                  <option value="ABUSE">رفتار نامناسب</option>
                  <option value="SPAM">هرزنامه</option>
                  <option value="SECURITY">حفاظت امنیتی</option>
                  <option value="INCIDENT_RESPONSE">رسیدگی به رخداد</option>
                  <option value="APPEAL">رسیدگی به اعتراض</option>
                </>
              ) : (
                <>
                  <option value="MAINTENANCE">نگه‌داری</option>
                  <option value="ACCESS_ADMINISTRATION">مدیریت دسترسی</option>
                  <option value="SUPPORT_CORRECTION">اصلاح با درخواست پشتیبانی</option>
                  <option value="INCIDENT_RESPONSE">رسیدگی امنیتی</option>
                </>
              )}
            </select>
          </label>
          {(intent?.operation === "USER_RESTRICT" || intent?.operation === "USER_UNRESTRICT") && (
            <label>
              توضیح محرمانه (اختیاری)
              <textarea
                maxLength={2000}
                value={privateNote}
                onChange={(e) => setPrivateNote(e.target.value)}
                autoComplete="off"
              />
              <span className="muted">
                رمزگذاری می‌شود؛ فقط با مجوز مستقل و ثبت مشاهده قابل خواندن است.
              </span>
            </label>
          )}
          <button disabled={busy}>ثبت درخواست تأیید</button>
        </form>
      ) : (
        <>
          <p role="status">{stateTitles[command.state]}</p>
          {command.resultCode === "INVALID_DISPLAY_NAME" && (
            <p role="alert">
              نام نمایشی معتبر نیست؛ حداکثر ۴۰ نویسه و بدون نویسهٔ کنترلی وارد کنید.
            </p>
          )}
          {command.resultCode === "VERSION_OR_STATE_CONFLICT" && (
            <p role="alert">
              نسخه یا وضعیت هدف تغییر کرده است. داده را تازه و درخواست جدیدی ثبت کنید.
            </p>
          )}
          <p>مهلت: {new Date(command.expiresAt).toLocaleTimeString("fa-IR")}</p>
          <p className="muted">
            دلیل: <bdi>{command.reasonCode}</bdi> · شناسهٔ درخواست: <bdi>{command.commandId}</bdi>
          </p>
          {(command.state === "PENDING" ||
            (command.state === "UNKNOWN" && command.mode === null)) && (
            <form
              onSubmit={(e) => {
                void run("approve", e);
              }}
            >
              <p>
                {props.isOwner
                  ? "تصمیم نهایی مالک با احراز هویت مجدد"
                  : "تأیید باید توسط مدیر دیگری با مجوز تأیید انجام شود."}
              </p>
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
              {props.isOwner && (
                <label>
                  PIN فعلی
                  <input
                    type="password"
                    dir="ltr"
                    autoComplete="off"
                    inputMode="numeric"
                    required
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                  />
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                هدف، تغییرات و اثر این عملیات را تأیید می‌کنم.
              </label>
              <button disabled={busy}>تأیید همین عملیات</button>
            </form>
          )}
          {(command.state === "APPROVED" || command.state === "UNKNOWN") && (
            <button
              disabled={busy}
              onClick={() => {
                void run("execute");
              }}
            >
              اجرای همین درخواست
            </button>
          )}
          {(command.state === "PENDING" ||
            command.state === "APPROVED" ||
            command.state === "UNKNOWN") && (
            <button
              disabled={busy}
              onClick={() => {
                void run("renew");
              }}
            >
              درخواست تأیید تازه برای همین عملیات
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => {
              void run("refresh");
            }}
          >
            بررسی نتیجه
          </button>
          {secret && (
            <div role="status">
              <p>
                رمز مدیر فقط اکنون نمایش داده می‌شود؛ آن را امن به مدیر تحویل دهید. پس از بستن یا یک
                دقیقه پاک می‌شود.
              </p>
              <output dir="ltr">{secret}</output>
              <button onClick={() => setSecret("")}>رمز را نگه‌داشتم؛ پنهان کن</button>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button disabled={busy} onClick={completed}>
        بستن و تازه‌کردن فهرست
      </button>
    </section>
  );
}

function PermissionEditor({
  grants,
  changed,
  environment,
}: {
  grants: Grant[];
  changed(v: Grant[]): void;
  environment: string;
}) {
  const permissions = adminPermissionSchema.options.filter((p) => !/^(admins|roles)\./.test(p));
  function update(index: number, value: Grant | null) {
    if (index < 0) {
      if (value) changed([...grants, value]);
      return;
    }
    changed(grants.flatMap((g, i) => (i === index ? (value ? [value] : []) : [g])));
  }
  return (
    <fieldset>
      <legend>مجوزهای صریح؛ منع بر اجازه اولویت دارد</legend>
      {permissions.map((permission) => {
        const matching = grants
          .map((grant, index) => ({ grant, index }))
          .filter((r) => r.grant.permission === permission);
        const rows = matching.length ? matching : [{ grant: null, index: -1 }];
        return (
          <fieldset key={permission}>
            <legend>
              <bdi>{permission}</bdi>
            </legend>
            {rows.map(({ grant, index }, rowIndex) => (
              <div className="permission-row" key={index}>
                <label>
                  قید {rowIndex + 1}
                  <select
                    aria-label={`مجوز ${permission} قید ${rowIndex + 1}`}
                    value={grant ? (grant.deny ? "deny" : "allow") : "none"}
                    onChange={(e) =>
                      update(
                        index,
                        e.target.value === "none"
                          ? null
                          : {
                              permission,
                              environment,
                              gameIds: grant?.gameIds ?? null,
                              deny: e.target.value === "deny",
                            },
                      )
                    }
                  >
                    <option value="none">اعطا نشده / حذف این قید</option>
                    <option value="allow">اجازه</option>
                    <option value="deny">منع صریح</option>
                  </select>
                </label>
                {grant && /^(games|rooms|matches)\./.test(permission) && (
                  <label>
                    بازی‌ها؛ خالی یعنی همه
                    <input
                      dir="ltr"
                      value={grant.gameIds?.join(",") ?? ""}
                      placeholder="coup,kahroba"
                      onChange={(e) =>
                        update(index, {
                          ...grant,
                          gameIds: e.target.value.trim()
                            ? e.target.value.split(",").map((v) => v.trim())
                            : null,
                        })
                      }
                    />
                  </label>
                )}
              </div>
            ))}
            {matching.length > 0 && /^(games|rooms|matches)\./.test(permission) && (
              <button
                type="button"
                disabled={grants.length >= 128}
                onClick={() =>
                  changed([...grants, { permission, environment, gameIds: null, deny: true }])
                }
              >
                افزودن قید منع دیگر؛ محدوده را مشخص کنید
              </button>
            )}
          </fieldset>
        );
      })}
    </fieldset>
  );
}

export function ManagementPanel(props: Props & { kind: "admins" | "operations" }) {
  const [directory, setDirectory] = useState<Directory | null>(null),
    [commands, setCommands] = useState<Command[]>([]),
    [revision, setRevision] = useState(0),
    [error, setError] = useState("");
  const [action, setAction] = useState<AdminAction | null>(null),
    [existing, setExisting] = useState<Command | null>(null);
  const [selected, setSelected] = useState<Directory["operators"][number] | null>(null),
    [role, setRole] = useState<Directory["roles"][number] | null>(null);
  const [username, setUsername] = useState(""),
    [name, setName] = useState(""),
    [grants, setGrants] = useState<Grant[]>([]),
    [roleIds, setRoleIds] = useState<string[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [activity, setActivity] = useState<z.infer<typeof adminActivitySchema> | null>(null);
  const [sessions, setSessions] = useState<z.infer<typeof adminSessionPageSchema> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setDirectory(null);
    setError("");
    void adminRequest(
      props.kind === "admins" ? "admins" + (cursor ? `?cursor=${cursor}` : "") : "operations",
      undefined,
      undefined,
      controller.signal,
    )
      .then((raw) => {
        if (!controller.signal.aborted) {
          if (props.kind === "admins") setDirectory(adminDirectorySchema.parse(raw));
          else setCommands(adminCommandPageSchema.parse(raw).items);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(failure);
      });
    return () => controller.abort();
  }, [props.kind, revision, cursor]);
  function completed() {
    setAction(null);
    setExisting(null);
    setSelected(null);
    setRole(null);
    setSessions(null);
    setRevision((v) => v + 1);
    void props.refreshed();
  }
  if (action || existing)
    return (
      <OperationFlow
        {...props}
        {...(action ? { action } : {})}
        {...(existing ? { existing } : {})}
        completed={completed}
      />
    );
  return (
    <section className="table-panel">
      <h2>
        {props.kind === "admins" ? "مدیران، نقش‌ها و دسترسی‌ها" : "درخواست‌ها و تأیید عملیات"}
      </h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {props.kind === "operations" ? (
        <ul>
          {commands.map((c) => (
            <li key={c.commandId}>
              <button onClick={() => setExisting(c)}>
                {operationTitles[c.action.operation]} · {stateTitles[c.state]} ·{" "}
                <bdi>{c.targetId}</bdi>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        directory && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setAction({
                  operation: "ADMIN_CREATE",
                  targetId: crypto.randomUUID(),
                  expectedVersion: 0,
                  username,
                });
              }}
            >
              <label>
                نام کاربری مدیر جدید
                <input
                  dir="ltr"
                  required
                  pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,63}"
                  minLength={3}
                  maxLength={64}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <button>ساخت مدیر با رمز تصادفی</button>
            </form>
            <ul>
              {directory.operators.map((o) => (
                <li key={o.id}>
                  <bdi>{o.username}</bdi> · {o.isOwner ? "مالک اصلی؛ محافظت‌شده" : o.status}
                  <button
                    onClick={() => {
                      void adminRequest(`admins/${o.id}/sessions`)
                        .then((raw) => setSessions(adminSessionPageSchema.parse(raw)))
                        .catch(() => setError(failure));
                    }}
                  >
                    نشست‌ها
                  </button>
                  <button
                    onClick={() => {
                      void adminRequest(`admins/${o.id}/activity`)
                        .then((raw) => setActivity(adminActivitySchema.parse(raw)))
                        .catch(() => setError(failure));
                    }}
                  >
                    تاریخچهٔ فعالیت و دسترسی
                  </button>
                  {!o.isOwner && (
                    <>
                      <button
                        onClick={() => {
                          setSelected(o);
                          setRole(null);
                          setRoleIds(o.roleIds);
                          setGrants(o.grants);
                        }}
                      >
                        ویرایش دسترسی
                      </button>
                      {(["ADMIN_RESET_PASSWORD", "ADMIN_REVOKE_SESSIONS"] as const).map(
                        (operation) => (
                          <button
                            key={operation}
                            onClick={() =>
                              setAction({ operation, targetId: o.id, expectedVersion: o.version })
                            }
                          >
                            {operationTitles[operation]}
                          </button>
                        ),
                      )}
                      {(["ACTIVE", "DISABLED", "DELETED"] as const).map((status) => (
                        <button
                          key={status}
                          disabled={o.status === "DELETED" || o.status === status}
                          onClick={() =>
                            setAction({
                              operation: "ADMIN_STATUS",
                              targetId: o.id,
                              expectedVersion: o.version,
                              status,
                            })
                          }
                        >
                          {status === "ACTIVE"
                            ? "فعال‌سازی"
                            : status === "DISABLED"
                              ? "غیرفعال‌سازی"
                              : "حذف منطقی"}
                        </button>
                      ))}
                    </>
                  )}
                </li>
              ))}
            </ul>
            {directory.nextCursor && (
              <button onClick={() => setCursor(directory.nextCursor)}>مدیران بعدی</button>
            )}
            {sessions && (
              <section>
                <h3>نشست‌های اخیر</h3>
                <ul>
                  {sessions.items.map((s) => (
                    <li key={s.id}>
                      <bdi>{s.id}</bdi> · {s.valid ? "معتبر" : "نامعتبر"} ·{" "}
                      {s.kind === "PENDING" ? "فاقد اختیار مدیریتی" : "کامل"} ·{" "}
                      {new Date(s.lastSeenAt).toLocaleString("fa-IR")}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {activity && (
              <section>
                <h3>تاریخچهٔ امنیتی</h3>
                <ul>
                  {activity.items.map((a) => (
                    <li key={a.id}>
                      <bdi>{a.event}</bdi> · <bdi>{a.operation}</bdi> · <bdi>{a.targetId}</bdi> ·{" "}
                      {new Date(a.occurredAt).toLocaleString("fa-IR")}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <h3>نقش‌ها</h3>
            <ul>
              {directory.roles.map((r) => (
                <li key={r.id}>
                  {r.name}
                  <button
                    onClick={() => {
                      setRole(r);
                      setSelected(null);
                      setName(r.name);
                      setGrants(r.grants);
                    }}
                  >
                    ویرایش نقش
                  </button>
                  <button
                    onClick={() =>
                      setAction({
                        operation: "ROLE_DELETE",
                        targetId: r.id,
                        expectedVersion: r.version,
                        expectedMemberCount: r.memberCount,
                      })
                    }
                  >
                    حذف نقش و لغو عضویت‌ها
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={() => {
                setSelected(null);
                setRole({
                  id: crypto.randomUUID(),
                  name: "",
                  version: 0,
                  memberCount: 0,
                  grants: [],
                });
                setName("");
                setGrants([]);
              }}
            >
              نقش سفارشی جدید
            </button>
            {(selected || role) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setAction(
                    selected
                      ? {
                          operation: "ADMIN_ACCESS",
                          targetId: selected.id,
                          expectedVersion: selected.version,
                          roleIds,
                          grants,
                        }
                      : {
                          operation: "ROLE_SAVE",
                          targetId: role!.id,
                          expectedVersion: role!.version,
                          expectedMemberCount: role!.memberCount,
                          name,
                          grants,
                        },
                  );
                }}
              >
                {selected ? (
                  <fieldset>
                    <legend>نقش‌های {selected.username}</legend>
                    {directory.roles.map((r) => (
                      <label key={r.id}>
                        <input
                          type="checkbox"
                          checked={roleIds.includes(r.id)}
                          onChange={(e) =>
                            setRoleIds(
                              e.target.checked
                                ? [...roleIds, r.id]
                                : roleIds.filter((id) => id !== r.id),
                            )
                          }
                        />
                        {r.name}
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <>
                    <label>
                      نام نقش
                      <input
                        required
                        minLength={2}
                        maxLength={64}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <p>الگوی آماده فقط نقطهٔ شروع است؛ مجوزها را پیش از ذخیره بررسی کنید.</p>
                    <TemplateButtons
                      environment={directory.environment}
                      selected={(n, g) => {
                        setName(n);
                        setGrants(g);
                      }}
                    />
                  </>
                )}
                <PermissionEditor
                  grants={grants}
                  changed={setGrants}
                  environment={directory.environment}
                />
                <button>بازبینی تغییر دسترسی</button>
              </form>
            )}
          </>
        )
      )}
    </section>
  );
}
function TemplateButtons({
  environment,
  selected,
}: {
  environment: string;
  selected(name: string, grants: Grant[]): void;
}) {
  const [templates, setTemplates] = useState<Record<string, string[]>>({});
  useEffect(() => {
    const controller = new AbortController();
    void adminRequest("management/meta", undefined, undefined, controller.signal)
      .then((raw) => {
        const value = adminManagementMetaSchema.parse(raw);
        if (!controller.signal.aborted) setTemplates(value.templates);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return (
    <div>
      {Object.entries(templates).map(([name, permissions]) => (
        <button
          key={name}
          type="button"
          onClick={() =>
            selected(
              name,
              permissions.map((permission) => ({
                permission: adminPermissionSchema.parse(permission),
                environment,
                gameIds: null,
                deny: false,
              })),
            )
          }
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export function ResourceActions(
  props: Props & {
    reload(): void;
    kind: string;
    row: { id: string; version: number | null; status: string };
  },
) {
  const [action, setAction] = useState<AdminAction | null>(null),
    [name, setName] = useState("");
  const { row } = props;
  if (action)
    return (
      <OperationFlow
        {...props}
        action={action}
        completed={() => {
          setAction(null);
          props.reload();
          void props.refreshed();
        }}
      />
    );
  if (row.version === null) return null;
  const base = { targetId: row.id, expectedVersion: row.version };
  return (
    <section className="table-panel">
      <h2>عملیات مجاز روی این مورد</h2>
      {props.kind === "games" && (
        <p>
          وضعیت پذیرش فقط Match جدید را محدود می‌کند؛ اجازهٔ انتشار بازی یا تغییر Match فعال نیست.
        </p>
      )}
      {props.kind === "users" && (
        <>
          {props.permissions.includes("users.edit") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setAction({ ...base, operation: "USER_DISPLAY_NAME", displayName: name });
              }}
            >
              <label>
                نام نمایشی جدید
                <input
                  required
                  minLength={1}
                  maxLength={128}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button>بازبینی اصلاح نام</button>
            </form>
          )}
        </>
      )}
      {props.kind === "games" &&
        props.permissions.includes("games.manage") &&
        (["ACTIVE", "MAINTENANCE", "DISABLED"] as const).map((status) => (
          <button
            key={status}
            onClick={() => setAction({ ...base, operation: "GAME_AVAILABILITY", status })}
          >
            {status === "ACTIVE"
              ? "اجازهٔ پذیرش طبق انتشار فعلی"
              : status === "MAINTENANCE"
                ? "نگه‌داری؛ توقف پذیرش جدید"
                : "بستن پذیرش جدید"}
          </button>
        ))}
      {props.kind === "rooms" && props.permissions.includes("rooms.manage") && (
        <button
          disabled={!["WAITING", "FULL"].includes(row.status)}
          onClick={() => setAction({ ...base, operation: "ROOM_CLOSE" })}
        >
          بستن اتاق پیش از شروع
        </button>
      )}
      {props.kind === "matches" && props.permissions.includes("matches.manage") && (
        <button
          disabled={["FINISHED", "TERMINATED"].includes(row.status)}
          onClick={() => setAction({ ...base, operation: "MATCH_TERMINATE" })}
        >
          توقف بدون نتیجهٔ مسابقه
        </button>
      )}
    </section>
  );
}

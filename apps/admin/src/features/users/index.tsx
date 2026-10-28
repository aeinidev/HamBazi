import { useEffect, useState } from "react";
import {
  adminManagementMetaSchema,
  adminUserProfileSchema,
  adminUserHistorySchema,
  adminUserRestrictionsSchema,
  adminPrivateNoteSchema,
  type AdminAction,
} from "@hambazi/validation";
import type { z } from "zod";
import { adminRequest } from "../../platform/http.js";
import { OperationFlow } from "../management/index.js";
const durations = {
  HOUR_1: "۱ ساعت",
  HOURS_24: "۲۴ ساعت",
  DAYS_7: "۷ روز",
  DAYS_30: "۳۰ روز",
  PERMANENT: "دائم",
} as const;
const matchStatuses: Record<string, string> = {
  CREATED: "ایجادشده",
  WAITING_FOR_PLAYERS: "منتظر بازیکنان",
  READY: "آماده",
  STARTING: "در حال شروع",
  ACTIVE: "در حال بازی",
  FINISHED: "پایان‌یافته",
  TERMINATED: "متوقف‌شده",
};
const reasons: Record<string, string> = {
  ABUSE: "رفتار نامناسب",
  SPAM: "هرزنامه",
  SECURITY: "حفاظت امنیتی",
  INCIDENT_RESPONSE: "رخداد امنیتی",
  APPEAL: "رسیدگی به اعتراض",
};
export function UserDetail(props: {
  id: string;
  csrf: string;
  isOwner: boolean;
  permissions: string[];
  refreshed(): Promise<void>;
  reload(): void;
}) {
  const [profile, setProfile] = useState<z.infer<typeof adminUserProfileSchema> | null>(null);
  const [history, setHistory] = useState<z.infer<typeof adminUserHistorySchema> | null>(null);
  const [restrictions, setRestrictions] = useState<z.infer<
    typeof adminUserRestrictionsSchema
  > | null>(null);
  const [enabled, setEnabled] = useState(false),
    [error, setError] = useState("");
  const [action, setAction] = useState<AdminAction | null>(null),
    [duration, setDuration] = useState<keyof typeof durations>("HOUR_1");
  const [note, setNote] = useState<string | null>(null);
  const permissionKey = props.permissions.join(",");
  const can = (p: string) => props.permissions.includes(p);
  useEffect(() => {
    const controller = new AbortController();
    const read = (path: string) => adminRequest(path, undefined, undefined, controller.signal);
    void Promise.all([
      read(`users/${props.id}/profile`).then((r) => setProfile(adminUserProfileSchema.parse(r))),
      read("management/meta").then((r) =>
        setEnabled(adminManagementMetaSchema.parse(r).restrictionsEnabled ?? false),
      ),
      ...(props.permissions.includes("users.history.view")
        ? [
            read(`users/${props.id}/history`).then((r) =>
              setHistory(adminUserHistorySchema.parse(r)),
            ),
          ]
        : []),
      ...(props.permissions.includes("users.restrictions.view")
        ? [
            read(`users/${props.id}/restrictions`).then((r) =>
              setRestrictions(adminUserRestrictionsSchema.parse(r)),
            ),
          ]
        : []),
    ]).catch(() => {
      if (!controller.signal.aborted)
        setError("اطلاعات کامل دریافت نشد؛ دسترسی و اتصال را بررسی کنید.");
    });
    return () => controller.abort();
  }, [props.id, permissionKey]);
  async function next(kind: "history" | "restrictions", cursor: string) {
    setNote(null);
    try {
      const raw = await adminRequest(
        `users/${props.id}/${kind}?cursor=${encodeURIComponent(cursor)}`,
      );
      if (kind === "history") setHistory(adminUserHistorySchema.parse(raw));
      else setRestrictions(adminUserRestrictionsSchema.parse(raw));
    } catch {
      setError("دریافت صفحهٔ بعد ممکن نشد.");
    }
  }
  function showNote(operationId: string) {
    setNote(null);
    void adminRequest(`operations/${operationId}/private-note`)
      .then((v) => setNote(adminPrivateNoteSchema.parse(v).privateNote ?? "توضیحی ثبت نشده است."))
      .catch(() => setError("مشاهدهٔ توضیح مجاز یا ممکن نیست."));
  }
  if (action)
    return (
      <OperationFlow
        {...props}
        action={action}
        completed={() => {
          setAction(null);
          props.reload();
        }}
      />
    );
  return (
    <section className="user-detail" aria-label="پروفایل و سوابق کاربر">
      {error && <p role="alert">{error}</p>}
      {profile && (
        <div className="table-panel">
          <h2>پروفایل کاربر</h2>
          <p>نام نمایشی: {profile.displayName}</p>
          <p>
            شناسهٔ عمومی: <bdi>{profile.publicHandle}</bdi>
          </p>
          <p>عضویت: {new Date(profile.createdAt).toLocaleDateString("fa-IR")}</p>
          <p>ثبت‌نام: {profile.registrationCompletedAt ? "تکمیل شده" : "ناتمام"}</p>
          <p className="muted">
            فقط نام نمایشی قابل اصلاح است؛ هویت تلگرام و نتایج بازی قابل ویرایش نیستند.
          </p>
        </div>
      )}
      {profile && can("users.restrictions.manage") && can("users.restrictions.view") && (
        <div className="table-panel">
          <h2>کنترل محرومیت</h2>
          {!enabled ? (
            <p>محروم‌سازی در این محیط فعال نشده است.</p>
          ) : profile.status === "ACTIVE" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setAction({
                  operation: "USER_RESTRICT",
                  targetId: props.id,
                  expectedVersion: profile.profileVersion,
                  duration,
                });
              }}
            >
              <label>
                مدت محرومیت
                <select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value as keyof typeof durations)}
                >
                  {Object.entries(durations).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button>پیش‌نمایش محرومیت</button>
            </form>
          ) : profile.status === "BANNED" && restrictions ? (
            <>
              <p>
                پایان:{" "}
                {restrictions.active?.expiresAt
                  ? new Date(restrictions.active.expiresAt).toLocaleString("fa-IR")
                  : "دائم"}
              </p>
              <button
                onClick={() =>
                  setAction({
                    operation: "USER_UNRESTRICT",
                    targetId: props.id,
                    expectedVersion: profile.profileVersion,
                    restrictionId: restrictions.active?.id ?? null,
                  })
                }
              >
                پیش‌نمایش رفع محرومیت
              </button>
            </>
          ) : null}
        </div>
      )}
      {history && (
        <section className="table-panel" aria-label="سوابق بازی">
          <h2>سوابق بازی</h2>
          {!history.items.length && <p>مسابقه‌ای ثبت نشده است.</p>}
          <ul>
            {history.items.map((r) => (
              <li key={r.id}>
                <bdi>{r.id}</bdi> · <bdi>{r.gameId}</bdi> ·{" "}
                <span>{matchStatuses[r.status] ?? r.status}</span> ·{" "}
                {r.winner === null ? "بدون نتیجه" : r.winner ? "برنده" : "پایان یافته"}
                {r.placement !== null && ` · رتبه: ${r.placement}`}
                <p>
                  شروع:{" "}
                  {r.startedAt ? new Date(r.startedAt).toLocaleString("fa-IR") : "هنوز شروع نشده"} ·
                  پایان:{" "}
                  {r.finishedAt ? new Date(r.finishedAt).toLocaleString("fa-IR") : "پایان نیافته"}
                </p>
              </li>
            ))}
          </ul>
          {history.nextCursor && (
            <button onClick={() => void next("history", history.nextCursor!)}>
              صفحهٔ بعد سوابق بازی
            </button>
          )}
        </section>
      )}
      {restrictions && (
        <section className="table-panel" aria-label="تاریخچه محرومیت">
          <h2>تاریخچهٔ محرومیت</h2>
          {!restrictions.items.length && <p>محرومیتی ثبت نشده است.</p>}
          <ul>
            {restrictions.items.map((r) => (
              <li key={r.id}>
                <p>
                  <bdi>{r.id}</bdi> · {reasons[r.reasonCode] ?? r.reasonCode} ·{" "}
                  {durations[r.duration as keyof typeof durations]} ·{" "}
                  {r.endKind === "EXPIRED"
                    ? "پایان خودکار"
                    : r.endKind === "REVOKED"
                      ? "رفع شده"
                      : "فعال"}
                </p>
                <p>
                  شروع: {new Date(r.createdAt).toLocaleString("fa-IR")} · مهلت تعیین‌شده:{" "}
                  {r.expiresAt ? new Date(r.expiresAt).toLocaleString("fa-IR") : "دائم"}
                </p>
                {r.endedAt && (
                  <p>
                    پایان اعمال‌شده: {new Date(r.endedAt).toLocaleString("fa-IR")}
                    {r.endedByOperationId && (
                      <>
                        {" "}
                        · درخواست رفع: <bdi>{r.endedByOperationId}</bdi>
                      </>
                    )}
                  </p>
                )}
                {can("users.restrictions.notes.view") && (
                  <>
                    <button onClick={() => showNote(r.id)}>مشاهدهٔ ثبت‌شوندهٔ توضیح محرمانه</button>
                    {r.endedByOperationId && (
                      <button onClick={() => showNote(r.endedByOperationId!)}>
                        مشاهدهٔ ثبت‌شوندهٔ توضیح رفع محرومیت
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {note !== null && (
            <div role="status">
              <p>{note}</p>
              <button onClick={() => setNote(null)}>بستن توضیح محرمانه</button>
            </div>
          )}
          {restrictions.nextCursor && (
            <button onClick={() => void next("restrictions", restrictions.nextCursor!)}>
              صفحهٔ بعد محرومیت‌ها
            </button>
          )}
        </section>
      )}
    </section>
  );
}

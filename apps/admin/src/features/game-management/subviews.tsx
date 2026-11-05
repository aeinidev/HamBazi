import { useEffect, useState } from "react";
import {
  adminRoomPlayersSchema,
  adminMatchPlayersSchema,
  adminMatchHistorySchema,
  adminRoomDiagnosticsSchema,
  adminMatchDiagnosticsSchema,
  type AdminRoomPlayers,
  type AdminMatchPlayers,
  type AdminMatchHistory,
  type AdminRoomDiagnostics,
  type AdminMatchDiagnostics,
} from "@hambazi/validation";
import { adminRequest } from "../../platform/http.js";
import type { ManagementProps } from "./details.js";
import { Timestamp } from "./timestamp.js";

type Navigation = Pick<ManagementProps, "permissions" | "navigate">;
type Resource = "rooms" | "matches";
type View = "players" | "history" | "diagnostics";
type Snapshot =
  | { view: "roomPlayers"; data: AdminRoomPlayers }
  | { view: "matchPlayers"; data: AdminMatchPlayers }
  | { view: "history"; data: AdminMatchHistory }
  | { view: "diagnostics"; data: AdminRoomDiagnostics | AdminMatchDiagnostics };

export function ProfileLink({ id, permissions, navigate }: Navigation & { id: string }) {
  return permissions.includes("users.view") ? (
    <button onClick={() => navigate("users", id)}>
      پروفایل کاربر <bdi>{id}</bdi>
    </button>
  ) : (
    <bdi>{id}</bdi>
  );
}

export function ResourceSubviews(props: Navigation & { kind: Resource; id: string }) {
  const can = (view: View) =>
    props.permissions.includes(`${props.kind}.view`) &&
    props.permissions.includes(`${props.kind}.${view}.view`);
  return (
    <>
      {can("players") && <Subview {...props} view="players" />}
      {props.kind === "matches" && can("history") && <Subview {...props} view="history" />}
      {can("diagnostics") && <Subview {...props} view="diagnostics" />}
    </>
  );
}

function Subview(props: Navigation & { kind: Resource; id: string; view: View }) {
  const { kind, id, view } = props;
  const [cursor, setCursor] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; value: Snapshot } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const permissionKey = props.permissions.join(",");
  const requestKey = `${kind}:${id}:${view}:${cursor}:${revision}:${permissionKey}`;
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    setFailure(null);
    const query =
      view === "history" ? `?limit=50${cursor === null ? "" : `&cursor=${cursor}`}` : "";
    void adminRequest(
      `${kind}/${encodeURIComponent(id)}/${view}${query}`,
      undefined,
      undefined,
      controller.signal,
    )
      .then((raw) => {
        const value: Snapshot =
          view === "players"
            ? kind === "rooms"
              ? { view: "roomPlayers", data: adminRoomPlayersSchema.parse(raw) }
              : { view: "matchPlayers", data: adminMatchPlayersSchema.parse(raw) }
            : view === "history"
              ? { view, data: adminMatchHistorySchema.parse(raw) }
              : {
                  view,
                  data:
                    kind === "rooms"
                      ? adminRoomDiagnosticsSchema.parse(raw)
                      : adminMatchDiagnosticsSchema.parse(raw),
                };
        const responseId =
          "roomId" in value.data
            ? value.data.roomId
            : "matchId" in value.data
              ? value.data.matchId
              : value.data.id;
        if (responseId !== id) throw new Error("SUBVIEW_ID_MISMATCH");
        if (!controller.signal.aborted) setSnapshot({ key: requestKey, value });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setFailure({
            key: requestKey,
            message: "دریافت این بخش ممکن نشد؛ دسترسی و اتصال را بررسی کنید. شواهد در دسترس نیست.",
          });
      });
    return () => controller.abort();
  }, [kind, id, view, cursor, requestKey]);
  const navigation = { permissions: props.permissions, navigate: props.navigate };
  const current = snapshot?.key === requestKey ? snapshot.value : null;
  const error = failure?.key === requestKey ? failure.message : null;
  const title =
    view === "players"
      ? kind === "rooms"
        ? "بازیکنان اتاق"
        : "بازیکنان مسابقه"
      : view === "history"
        ? "تاریخچهٔ مسابقه"
        : "تشخیص وضعیت";
  return (
    <section className="table-panel" aria-label={title}>
      <h2>{title}</h2>
      <button
        onClick={() => {
          setCursor(null);
          setRevision((value) => value + 1);
        }}
      >
        {view === "players"
          ? "تازه‌سازی بازیکنان"
          : view === "history"
            ? "تازه‌سازی تاریخچه"
            : "تازه‌سازی تشخیص"}
      </button>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : !current ? (
        <p role="status">در حال دریافت این بخش…</p>
      ) : null}
      {current && (
        <>
          <p>
            زمان مشاهده: <Timestamp value={current.data.asOf} />
          </p>
          {current.view === "roomPlayers" ? (
            <RoomPlayers data={current.data} {...navigation} />
          ) : current.view === "matchPlayers" ? (
            <MatchPlayers data={current.data} {...navigation} />
          ) : current.view === "history" ? (
            <History data={current.data} {...navigation} next={setCursor} />
          ) : (
            <Diagnostics data={current.data} />
          )}
        </>
      )}
    </section>
  );
}

function RoomPlayers({ data, ...navigation }: Navigation & { data: AdminRoomPlayers }) {
  return data.items.length === 0 ? (
    <p className="empty">بازیکنی ثبت نشده است.</p>
  ) : (
    <div className="table-scroll" role="region" aria-label="جدول اعضای اتاق" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th>صندلی</th>
            <th>کاربر</th>
            <th>عضویت</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((player) => (
            <tr key={player.userId}>
              <td>{player.seat}</td>
              <td>
                <ProfileLink id={player.userId} {...navigation} />
              </td>
              <td>
                <Timestamp value={player.joinedAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const connections = {
  CONNECTED: "متصل",
  DISCONNECTED: "قطع‌شده",
  REPLACED_BY_BOT: "جایگزین‌شده با ربات",
};
function MatchPlayers({ data, ...navigation }: Navigation & { data: AdminMatchPlayers }) {
  return data.items.length === 0 ? (
    <p className="empty">بازیکنی ثبت نشده است.</p>
  ) : (
    <div className="table-scroll" role="region" aria-label="جدول بازیکنان مسابقه" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th>صندلی</th>
            <th>بازیکن</th>
            <th>کنترل‌کننده</th>
            <th>عضویت و اتصال</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((player) => (
            <tr key={player.kind === "SERVER_BOT" ? player.actorId : player.userId}>
              <td>{player.seat}</td>
              <td>
                {player.kind === "SERVER_BOT" ? (
                  <>
                    ربات سرور · <bdi>{player.actorId}</bdi>
                  </>
                ) : (
                  <ProfileLink id={player.userId} {...navigation} />
                )}
              </td>
              <td>{player.agentType === "HUMAN" ? "انسان" : "ربات"}</td>
              <td>
                {player.kind === "SERVER_BOT" ? (
                  "قابل اعمال نیست"
                ) : (
                  <>
                    <p>
                      عضویت: <Timestamp value={player.joinedAt} />
                    </p>
                    <p>
                      وضعیت اتصال: {connections[player.connectionStatus]} · نسخهٔ اتصال:{" "}
                      {player.connectionEpoch}
                    </p>
                    <p>
                      آمادگی: <Timestamp value={player.readyAt} />
                    </p>
                    <p>
                      قطع اتصال: <Timestamp value={player.disconnectedAt} />
                    </p>
                    <p>
                      مهلت بازگشت: <Timestamp value={player.disconnectDeadlineAt} />
                    </p>
                    <p>
                      جایگزینی با ربات: <Timestamp value={player.replacedAt} />
                    </p>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const eventTitles = {
  MATCH_LIFECYCLE_V1: "تغییر چرخهٔ مسابقه",
  MATCH_INITIALIZED_V1: "آغاز وضعیت مسابقه",
  MATCH_FINISHED_V1: "پایان مسابقه",
  MATCH_FINISHED_V2: "پایان مسابقه",
  PLAYER_DISCONNECTED_V1: "قطع اتصال بازیکن",
  PLAYER_RECONNECTED_V1: "بازگشت بازیکن",
  PLAYER_BOT_TAKEOVER_V1: "جایگزینی بازیکن با ربات",
};
function History({
  data,
  next,
  ...navigation
}: Navigation & { data: AdminMatchHistory; next(cursor: number): void }) {
  return (
    <>
      <p className="muted">
        فقط فرادادهٔ مجاز رویدادها نمایش داده می‌شود؛ این بخش بازپخش بازی نیست.
      </p>
      {data.items.length === 0 ? (
        <p className="empty">رویدادی ثبت نشده است.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="جدول تاریخچهٔ مسابقه" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>شماره</th>
                <th>رویداد</th>
                <th>کاربر عامل</th>
                <th>نسخهٔ ساختار</th>
                <th>زمان ثبت</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((event) => (
                <tr key={event.id}>
                  <td>{event.seq}</td>
                  <td>
                    {eventTitles[event.type]} · <bdi>{event.type}</bdi>
                    <p>
                      شناسه: <bdi>{event.id}</bdi>
                    </p>
                  </td>
                  <td>
                    {event.actorUserId ? (
                      <ProfileLink id={event.actorUserId} {...navigation} />
                    ) : (
                      "کاربری ثبت نشده"
                    )}
                  </td>
                  <td>{event.schemaVersion}</td>
                  <td>
                    <Timestamp value={event.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.nextCursor !== null && (
        <button onClick={() => next(data.nextCursor!)}>صفحهٔ بعد تاریخچه</button>
      )}
      <section aria-label="نتایج ثبت‌شده">
        <h3>نتایج ثبت‌شده</h3>
        <p>
          زمان مشاهده: <Timestamp value={data.asOf} />
        </p>
        {data.results.length === 0 && (
          <p className="empty">نتیجه‌ای برای بازیکن ثبت‌شده در دسترس نیست.</p>
        )}
        <ul>
          {data.results.map((player) => (
            <li key={player.userId}>
              <ProfileLink id={player.userId} {...navigation} /> ·{" "}
              {player.winner === null ? "نتیجه ثبت نشده" : player.winner ? "برنده" : "برنده نیست"} ·{" "}
              {player.placement === null ? "رتبه ثبت نشده" : `رتبه: ${player.placement}`}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
const diagnosticStates = {
  NO_SIGNAL: "نشانه‌ای مشاهده نشد",
  SUSPECTED: "نیازمند بررسی",
  UNKNOWN: "شواهد کافی در دسترس نیست",
};
const diagnosticReasons = {
  ROOM_EXPIRED: "مهلت اتاق گذشته است",
  RECONNECT_OVERDUE: "مهلت بازگشت بازیکن گذشته است",
  DEADLINE_NOT_ELAPSED: "مهلت ثبت‌شده هنوز نگذشته است",
  TERMINAL: "وضعیت پایانی",
  NOT_APPLICABLE: "برای این وضعیت قابل اعمال نیست",
  NO_DURABLE_DEADLINE: "مهلت پایدار ثبت نشده است",
};
function Diagnostics({ data }: { data: AdminRoomDiagnostics | AdminMatchDiagnostics }) {
  return (
    <>
      <p>
        {diagnosticStates[data.state]} · <bdi>{data.state}</bdi>
      </p>
      <p>
        دلیل مشاهده: {diagnosticReasons[data.reason]} · <bdi>{data.reason}</bdi>
      </p>
      <p className="muted">
        این مشاهده تأیید سلامت نیست و فقط بر شواهد پایدار در زمان مشاهده تکیه دارد؛ هیچ تغییری
        خودکار انجام نمی‌شود.
      </p>
    </>
  );
}

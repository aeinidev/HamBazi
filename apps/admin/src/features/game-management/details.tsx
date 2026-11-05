import { useEffect, useState } from "react";
import {
  adminGameDetailSchema,
  adminRoomDetailSchema,
  adminMatchDetailSchema,
  type AdminGameDetail,
  type AdminRoomDetail,
  type AdminMatchDetail,
} from "@hambazi/validation";
import { adminRequest } from "../../platform/http.js";
import { ResourceActions } from "../management/index.js";
import { ResourceSubviews, ProfileLink } from "./subviews.js";
import { Timestamp } from "./timestamp.js";

export interface ManagementProps {
  kind: "games" | "rooms" | "matches";
  csrf: string;
  isOwner: boolean;
  permissions: string[];
  managementEnabled: boolean;
  refreshed(): Promise<void>;
  navigate(kind: "users" | "rooms" | "matches", id: string): void;
}
export const statusTitles: Record<string, string> = {
  ACTIVE: "فعال",
  MAINTENANCE: "در دست نگه‌داری",
  DISABLED: "غیرفعال",
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
type Detail =
  | { kind: "games"; data: AdminGameDetail }
  | { kind: "rooms"; data: AdminRoomDetail }
  | { kind: "matches"; data: AdminMatchDetail };

export function ResourceDetail(props: ManagementProps & { id: string; reload(): void }) {
  const { kind, id } = props;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void adminRequest(
      `${kind}/${encodeURIComponent(id)}/details`,
      undefined,
      undefined,
      controller.signal,
    )
      .then((raw) => {
        const result: Detail =
          kind === "games"
            ? { kind, data: adminGameDetailSchema.parse(raw) }
            : kind === "rooms"
              ? { kind, data: adminRoomDetailSchema.parse(raw) }
              : { kind, data: adminMatchDetailSchema.parse(raw) };
        if (result.data.item.id !== id) throw new Error("DETAIL_ID_MISMATCH");
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("دریافت جزئیات ممکن نشد؛ دسترسی و اتصال را بررسی کنید.");
      });
    return () => controller.abort();
  }, [kind, id]);
  const row = detail?.data.item;
  return (
    <section className="user-detail">
      <button onClick={props.reload}>تازه‌سازی جزئیات</button>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : !detail ? (
        <p role="status">در حال دریافت جزئیات…</p>
      ) : null}
      {detail && row && (
        <>
          <div className="table-panel">
            <h2>جزئیات {kind === "games" ? "بازی" : kind === "rooms" ? "اتاق" : "مسابقه"}</h2>
            <p>
              زمان مشاهده: <Timestamp value={detail.data.asOf} />
            </p>
            <p>
              شناسه: <bdi>{row.id}</bdi>
            </p>
            <p>نسخه: {row.version}</p>
            {detail.kind === "games" ? (
              <GameFields item={detail.data.item} />
            ) : detail.kind === "rooms" ? (
              <RoomFields
                item={detail.data.item}
                permissions={props.permissions}
                navigate={props.navigate}
              />
            ) : (
              <MatchFields
                item={detail.data.item}
                permissions={props.permissions}
                navigate={props.navigate}
              />
            )}
          </div>
          {kind !== "games" && <ResourceSubviews {...props} kind={kind} id={id} />}
          {props.managementEnabled && (
            <ResourceActions
              {...props}
              key={`${row.id}:${row.version}`}
              row={{
                id: row.id,
                version: row.version,
                status: "admissionStatus" in row ? row.admissionStatus : row.status,
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
function GameFields({ item }: { item: AdminGameDetail["item"] }) {
  return (
    <>
      <p>عنوان: {item.title}</p>
      <p>
        نام مسیر: <bdi>{item.slug}</bdi>
      </p>
      <p>وضعیت انتشار: {statusTitles[item.releaseStatus]}</p>
      <p>وضعیت پذیرش: {statusTitles[item.admissionStatus]}</p>
      <p>
        تعداد بازیکنان: {item.minPlayers} تا {item.maxPlayers}
      </p>
      <p>
        هم‌بازی‌یابی: {item.matchmakingEnabled ? "فعال" : "غیرفعال"} · اتاق خصوصی:{" "}
        {item.privateRoomsEnabled ? "فعال" : "غیرفعال"} · گفتگوی متنی:{" "}
        {item.chatEnabled ? "فعال" : "غیرفعال"} · گفتگوی صوتی:{" "}
        {item.voiceEnabled ? "فعال" : "غیرفعال"}
      </p>
      <p>نسخهٔ ساختار تنظیمات: {item.configSchemaVersion}</p>
      {item.installedVersions === null ? (
        <p>نسخه‌های نصب‌شده: در دسترس نیست</p>
      ) : (
        <>
          <p>نسخه‌های نصب‌شده: {item.installedVersions.length === 0 ? "موردی ثبت نشده" : ""}</p>
          <ul>
            {item.installedVersions.map((pin) => (
              <li key={`${pin.engineVersion}:${pin.stateSchemaVersion}:${pin.rulesetVersion}`}>
                موتور: <bdi>{pin.engineVersion}</bdi> · ساختار وضعیت: {pin.stateSchemaVersion} ·
                قوانین: <bdi>{pin.rulesetVersion}</bdi>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
function RoomFields({
  item,
  permissions,
  navigate,
}: { item: AdminRoomDetail["item"] } & Pick<ManagementProps, "permissions" | "navigate">) {
  return (
    <>
      <p>
        بازی: <bdi>{item.gameId}</bdi>
      </p>
      <p>وضعیت: {statusTitles[item.status]}</p>
      <p>ظرفیت: {item.capacity}</p>
      <p>
        میزبان: <ProfileLink id={item.hostUserId} permissions={permissions} navigate={navigate} />
      </p>
      <p>
        مسابقهٔ شروع‌شده:{" "}
        {item.startedMatchId ? (
          permissions.includes("matches.view") ? (
            <button onClick={() => navigate("matches", item.startedMatchId!)}>
              مشاهدهٔ مسابقه <bdi>{item.startedMatchId}</bdi>
            </button>
          ) : (
            <bdi>{item.startedMatchId}</bdi>
          )
        ) : (
          "ثبت نشده"
        )}
      </p>
      <p>
        ایجاد: <Timestamp value={item.createdAt} />
      </p>
      <p>
        آخرین تغییر: <Timestamp value={item.updatedAt} />
      </p>
      <p>
        انقضا: <Timestamp value={item.expiresAt} />
      </p>
    </>
  );
}
function MatchFields({
  item,
  permissions,
  navigate,
}: { item: AdminMatchDetail["item"] } & Pick<ManagementProps, "permissions" | "navigate">) {
  return (
    <>
      <p>
        بازی: <bdi>{item.gameId}</bdi>
      </p>
      <p>وضعیت: {statusTitles[item.status]}</p>
      <p>
        اتاق:{" "}
        {item.roomId ? (
          permissions.includes("rooms.view") ? (
            <button onClick={() => navigate("rooms", item.roomId!)}>
              مشاهدهٔ اتاق <bdi>{item.roomId}</bdi>
            </button>
          ) : (
            <bdi>{item.roomId}</bdi>
          )
        ) : (
          "بدون اتاق"
        )}
      </p>
      <p>
        نوع مسابقه:{" "}
        {item.matchType === "PRIVATE_ROOM" ? (
          "اتاق خصوصی"
        ) : item.matchType === "MATCHMAKING" ? (
          "هم‌بازی‌یابی"
        ) : item.matchType === "PERSONAL_BOTS_V1" ? (
          "شخصی با ربات‌ها"
        ) : (
          <>
            ناشناخته · <bdi>{item.matchType}</bdi>
          </>
        )}
      </p>
      <p>آخرین شمارهٔ رویداد: {item.lastEventSeq}</p>
      <p>
        نسخه‌های ثابت مسابقه · موتور: <bdi>{item.pins.engineVersion}</bdi> · ساختار وضعیت:{" "}
        {item.pins.stateSchemaVersion} · قوانین: <bdi>{item.pins.rulesetVersion}</bdi>
      </p>
      <p>
        ایجاد: <Timestamp value={item.createdAt} />
      </p>
      <p>
        آخرین تغییر: <Timestamp value={item.updatedAt} />
      </p>
      <p>
        شروع: <Timestamp value={item.startedAt} />
      </p>
      <p>
        پایان: <Timestamp value={item.finishedAt} />
      </p>
    </>
  );
}

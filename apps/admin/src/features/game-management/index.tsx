import { useEffect, useState, type FormEvent } from "react";
import {
  adminGamePageSchema,
  adminGameSearchQuerySchema,
  adminRoomPageSchema,
  adminRoomSearchQuerySchema,
  adminMatchPageSchema,
  adminMatchSearchQuerySchema,
  type AdminGamePage,
  type AdminRoomPage,
  type AdminMatchPage,
} from "@hambazi/validation";
import { adminRequest } from "../../platform/http.js";
import { ResourceDetail, statusTitles, Timestamp, type ManagementProps } from "./details.js";

const titles = { games: "بازی", rooms: "اتاق", matches: "مسابقه" };
const states = {
  games: ["ACTIVE", "MAINTENANCE", "DISABLED"],
  rooms: ["WAITING", "FULL", "STARTING", "STARTED", "CLOSED", "EXPIRED"],
  matches: [
    "CREATED",
    "WAITING_FOR_PLAYERS",
    "READY",
    "STARTING",
    "ACTIVE",
    "FINISHED",
    "TERMINATED",
  ],
};
type Page = AdminGamePage | AdminRoomPage | AdminMatchPage;

export function GameManagement(props: ManagementProps & { resourceRevision: number }) {
  const { kind } = props;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [gameId, setGameId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{ key: string; data: Page } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestKey = `${kind}:${query}:${cursor}:${revision}:${props.resourceRevision}`;
  useEffect(() => {
    if (selected) return;
    const controller = new AbortController();
    const params = new URLSearchParams(query);
    params.set("limit", "50");
    if (cursor) params.set("cursor", cursor);
    setPage(null);
    setLoading(true);
    setError("");
    void adminRequest(`${kind}/search?${params}`, undefined, undefined, controller.signal)
      .then((raw) => {
        const data =
          kind === "games"
            ? adminGamePageSchema.parse(raw)
            : kind === "rooms"
              ? adminRoomPageSchema.parse(raw)
              : adminMatchPageSchema.parse(raw);
        if (!controller.signal.aborted) setPage({ key: requestKey, data });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("دریافت اطلاعات ممکن نشد؛ دسترسی و اتصال را بررسی کنید.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [kind, query, cursor, selected, requestKey]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries({
      search,
      status,
      gameId,
      playerId,
      createdFrom,
      createdTo,
    })) {
      if (value.trim()) params.set(name, value.trim());
    }
    const schema =
      kind === "games"
        ? adminGameSearchQuerySchema
        : kind === "rooms"
          ? adminRoomSearchQuerySchema
          : adminMatchSearchQuerySchema;
    if (!schema.safeParse(Object.fromEntries(params)).success) {
      setError("فیلتر معتبر نیست؛ شناسه‌ها، تاریخ UTC و ترتیب بازه را بررسی کنید.");
      return;
    }
    setCursor(null);
    setQuery(params.toString());
    setRevision((value) => value + 1);
  }
  const reload = () => setRevision((value) => value + 1);
  if (selected)
    return (
      <>
        <button onClick={() => setSelected(null)}>بازگشت به فهرست</button>
        <ResourceDetail
          {...props}
          key={`${selected}:${revision}:${props.resourceRevision}`}
          id={selected}
          reload={reload}
        />
      </>
    );
  const currentPage = page?.key === requestKey ? page.data : null;
  return (
    <>
      <form className="table-panel user-search" onSubmit={submit}>
        <label>
          جستجوی {titles[kind]}
          <input
            maxLength={64}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          وضعیت {titles[kind]}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">همه</option>
            {states[kind].map((value) => (
              <option key={value} value={value}>
                {statusTitles[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          شناسهٔ بازی
          <input
            dir="ltr"
            maxLength={64}
            value={gameId}
            onChange={(event) => setGameId(event.target.value)}
          />
        </label>
        {kind === "matches" && (
          <label>
            شناسهٔ بازیکن
            <input
              dir="ltr"
              maxLength={36}
              value={playerId}
              onChange={(event) => setPlayerId(event.target.value)}
            />
          </label>
        )}
        {kind !== "games" && (
          <>
            <label>
              ایجاد از (UTC، ISO 8601)
              <input
                dir="ltr"
                placeholder="2026-01-01T00:00:00.000Z"
                value={createdFrom}
                onChange={(event) => setCreatedFrom(event.target.value)}
              />
            </label>
            <label>
              ایجاد تا (UTC، ISO 8601)
              <input
                dir="ltr"
                placeholder="2026-01-31T00:00:00.000Z"
                value={createdTo}
                onChange={(event) => setCreatedTo(event.target.value)}
              />
            </label>
          </>
        )}
        <button>اعمال فیلتر</button>
      </form>
      <button onClick={reload}>تازه‌سازی فهرست</button>
      {loading && <p role="status">در حال دریافت اطلاعات…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {currentPage && (
        <section className="table-panel">
          <p>
            زمان مشاهده: <Timestamp value={currentPage.asOf} />
          </p>
          {currentPage.items.length === 0 ? (
            <p className="empty">موردی یافت نشد.</p>
          ) : (
            <div
              className="table-scroll"
              role="region"
              aria-label={`فهرست ${titles[kind]}`}
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>شناسه</th>
                    <th>{kind === "games" ? "عنوان" : "شناسهٔ بازی"}</th>
                    <th>{kind === "games" ? "وضعیت پذیرش" : "وضعیت"}</th>
                    <th>نسخه</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPage.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <button
                          onClick={() => {
                            setPage(null);
                            setSelected(row.id);
                          }}
                        >
                          <bdi>{row.id}</bdi>
                        </button>
                      </td>
                      <td>{"title" in row ? row.title : <bdi>{row.gameId}</bdi>}</td>
                      <td>
                        {statusTitles["admissionStatus" in row ? row.admissionStatus : row.status]}
                      </td>
                      <td>{row.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {currentPage.nextCursor && (
            <button onClick={() => setCursor(currentPage.nextCursor)}>صفحهٔ بعد</button>
          )}
        </section>
      )}
    </>
  );
}

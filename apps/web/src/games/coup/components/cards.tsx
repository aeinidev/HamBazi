import type { CoupRole } from "../adapters/index.js";
export const roleNames: Record<CoupRole, string> = {
  DUKE: "بزرگ‌زاده",
  AMBASSADOR: "سفیر",
  ASSASSIN: "آدمکش",
  CAPTAIN: "کاپیتان",
  CONTESSA: "شاه‌دخت",
};
export const roleInfo: Record<CoupRole, string> = {
  DUKE: "با ادعای بزرگ‌زاده مالیات می‌گیری؛ می‌تواند کمک خارجی را مسدود کند.",
  AMBASSADOR:
    "با ادعای سفیر دو کارت از دسته می‌گیری و به تعداد نفوذ زندهٔ خودت نگه می‌داری. می‌تواند سرقت از خودش را مسدود کند.",
  ASSASSIN:
    "با ادعای آدمکش و پرداخت هزینه، به یک حریف حمله می‌کنی؛ در صورت موفقیت یک نفوذ از دست می‌دهد.",
  CAPTAIN: "با ادعای کاپیتان از حریف سکه می‌گیری؛ می‌تواند سرقت از خودش را مسدود کند.",
  CONTESSA:
    "می‌تواند آدمکشی را مسدود کند. در قوانین آنارشیست، شاه‌دختِ زندهٔ واقعی خودکار دفاع می‌کند، برای دو ثانیه نمایش داده می‌شود و با یک کارت از دسته تعویض می‌شود.",
};
const artwork: Record<CoupRole, string> = {
  DUKE: "duke",
  AMBASSADOR: "ambassador",
  ASSASSIN: "assassin",
  CAPTAIN: "captain",
  CONTESSA: "contessa",
};
export function InfluenceCard({
  role,
  detail,
  lost = false,
}: {
  role: CoupRole;
  detail?: (() => void) | undefined;
  lost?: boolean;
}) {
  return (
    <div className={`influence-card ${lost ? "lost" : ""}`}>
      <img
        src={`/assets/coup/${artwork[role]}.jpeg`}
        alt=""
        width="896"
        height="1200"
        draggable={false}
      />
      <span className="influence-name">{roleNames[role]}</span>
      {detail && (
        <button className="card-detail" aria-label={`اطلاعات ${roleNames[role]}`} onClick={detail}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10" cy="10" r="6" />
            <path d="m15 15 6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
export function CardBack() {
  return (
    <span className="influence-back" role="img" aria-label="کارت مخفی">
      <svg viewBox="0 0 40 56" aria-hidden="true">
        <path d="M20 6 34 28 20 50 6 28Z" />
        <path d="M20 14 29 28 20 42 11 28Z" />
        <circle cx="20" cy="28" r="4" />
      </svg>
    </span>
  );
}
export function CoinIcon() {
  return (
    <svg className="coin-icon" viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="6" rx="8" ry="4" />
      <path d="M4 6v4c0 5 16 5 16 0V6M4 10v4c0 5 16 5 16 0v-4M4 14v4c0 5 16 5 16 0v-4" />
    </svg>
  );
}

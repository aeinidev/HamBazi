import type { ReactNode } from "react";
import "./telegram-welcome.css";

/** Browser entry and expired sessions both require a fresh Telegram launch. */
export function TelegramWelcome({ expired, children }: { expired: boolean; children?: ReactNode }) {
  return (
    <section
      className="telegram-welcome"
      lang="fa"
      dir="rtl"
      aria-labelledby="telegram-welcome-title"
    >
      <div className="telegram-welcome-brand" aria-label="هم‌بازی">
        <span>هم</span>‌بازی
      </div>
      <div className="telegram-welcome-art" aria-hidden="true">
        <img
          src="/assets/loading/tabletop-640-9475bee80501.webp"
          srcSet="/assets/loading/tabletop-640-9475bee80501.webp 640w, /assets/loading/tabletop-1024-33456df6ae3f.webp 1024w"
          sizes="(min-width: 760px) 440px, 100vw"
          width="1024"
          height="1536"
          alt=""
          fetchPriority="high"
          decoding="async"
        />
      </div>
      <div className="telegram-welcome-copy">
        <p className="telegram-welcome-kicker">
          <span aria-hidden="true">✦</span> دنیای بازی‌های دورهمی
        </p>
        <h1 id="telegram-welcome-title">
          {expired ? "دوباره به بازی برگردید" : "یک قدم تا دنیای هم‌بازی"}
        </h1>
        <p className="telegram-welcome-description">
          {expired
            ? "نشست شما به پایان رسیده است. برای ادامه، هم‌بازی را دوباره از ربات تلگرام باز کنید."
            : "جای شما پای میز بازی خالی‌ست! برای ورود و شروع بازی، هم‌بازی را از ربات تلگرام باز کنید."}
        </p>
        <a
          className="telegram-welcome-action"
          href="https://t.me/Hambazidev_bot"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m21 4-3.3 16-5.2-4-2.7 2.5.5-5.2L18 6.8l-9.6 5.5L3 10.5 21 4Z"
              fill="currentColor"
            />
          </svg>
          باز کردن ربات هم‌بازی
          <span className="telegram-welcome-arrow" aria-hidden="true">
            ↗
          </span>
        </a>
        <ol className="telegram-welcome-steps" aria-label="مراحل ورود">
          <li>
            <span aria-hidden="true">۱</span> ربات را در تلگرام باز کنید
          </li>
          <li>
            <span aria-hidden="true">۲</span> دکمهٔ <bdi lang="en">Open</bdi> را بزنید و وارد شوید
          </li>
        </ol>
        {children}
      </div>
      <p className="telegram-welcome-footer">هر بازی، شروع یک خاطره</p>
    </section>
  );
}

# ADR-086 — محرومیت کاربر و نسل پایدار نشست

- **Status:** توسعهٔ محلیِ پذیرفته‌شدهٔ قبلی؛ فعال‌سازی فاز دوم طبق [ADR-087](087-admin-phase-two-release-boundary.md) متوقف و به تصمیم مستقل فاز سوم موکول شد. متن تصمیم قبلی در ادامه حفظ شده است.
- **Date:** 2026-10-27
- **Owner:** مالک HamBazi
- **Supersedes:** فقط تعویق محروم‌سازی از فاز دوم به سوم در OD-005؛ سایر moderation/support/reportها در فاز بعد باقی می‌مانند.
- **Related:** ADR-039، ADR-079، ADR-081 و ADR-085.

## Context

هویت بازیکن در هر احراز هویت از Users بررسی می‌شود. تغییر status به BANNED جلوی استفاده را می‌گیرد، ولی برگرداندن آن به ACTIVE می‌توانست token قدیمیِ هنوز منقضی‌نشده را دوباره معتبر کند. Admin اجازهٔ نوشتن مستقیم در session متعلق به Auth ندارد.

## Decision

Users مالک `auth_version` با مقدار پیش‌فرض صفر است. هر فرمان محرومیت یا رفع محرومیت با مجوز مستقل `users.manage`، تأیید `users.approve` یا OWNER_FINAL، reason، expectedVersion و receipt/Audit مسیر ADR-085 اجرا می‌شود؛ `profile_version` و `auth_version` در همان تراکنش اثر/receipt افزایش می‌یابند. تنها statusهای ACTIVE/BANNED قابل تبدیل‌اند؛ حساب DELETED احیا نمی‌شود و username/هویت Telegram/handle تغییر نمی‌کنند.

Auth مقدار نسل را هنگام صدور در metadata نشست خود pin و در هر authenticate با identity فعلی Users مقایسه می‌کند. JWT و wire contract بازیکن تغییر نمی‌کنند و هیچ claim از client authority نیست. رکوردها و fixtureهای قدیمی، نسل صفر دارند. retry فرمان صدور نشستِ نسل قدیمی پس از رفع محرومیت رد می‌شود؛ صدور تازه با initData معتبر و commandId جدید لازم است. احراز هویت و recheck پس از async signing نیز نسل را بررسی می‌کنند.

درخواست جدید HTTP، فرمان Socket و delivery/heartbeat که از gate موجود عبور می‌کند به محض مشاهدهٔ وضعیت/نسل جدید رد می‌شود؛ نشست بازیکن از لحاظ منطقی revoke شده و با unban زنده نمی‌شود. connection بدون ترافیک الزام «قطع فیزیکی ظرف پنج ثانیه» ندارد؛ سقف پنج‌ثانیهٔ معماری برای revoke مجوز مدیر است. صدور یا intent عبورکرده پیش از commit محرومیت، in-flight است؛ پاسخ‌های بعدی باید مجدداً authorize شوند.

محرومیت state یا نتیجهٔ Match فعال را تغییر نمی‌دهد، صندلی را دستی جابه‌جا نمی‌کند و بردی نمی‌سازد؛ رفتار disconnect/reconnect و Bot takeover همان قواعد Match است. حذف chat یا رسیدگی محتوایی اضافه نمی‌شود.

## Alternatives

فقط status، TTL کوتاه‌تر JWT، نوشتن Admin در جدول Auth، و blacklist Redis رد شدند؛ به‌ترتیب نشست قدیمی را زنده می‌کنند، revoke قطعی ندارند، ownership را می‌شکنند یا durable نیستند.

## Consequences

migration افزایشی است، اما **فعال‌کردن این عملیات با Auth/Gateway قدیمی مجاز نیست**. در استقرار آینده ابتدا API/Gatewayهای تازه و schema سازگار نصب و فرآیندهای قدیمی drain شوند، سپس grant/کلید فعال‌سازی mutation Admin باز شود. rollback به Auth قدیمی در حالی که ban/unban پذیرفته شده، امن نیست: admission بسته می‌ماند تا rollback سازگار یا revoke خصوصیِ بررسی‌شدهٔ نشست‌های affected انجام شود؛ هیچ bypass خودکار وجود ندارد.

تست‌های لازم: ban فوری، unban بدون احیای token، retry صدور قدیمی، صدور تازه، race نسخه/فرمان تکراری، deny/IDOR، خرابی Audit بدون اثر و حفظ state/result Match. این تصمیم مجوز تغییر روی سرور نیست.

# آماده‌سازی مراسم سادهٔ OWNER در Staging — ۲۶ اکتبر ۲۰۲۶

> **به‌روزرسانی اجرایی:** پیش‌نیاز نصب با مجوز بعدی مالک انجام شد؛ [گزارش نصب خصوصی](admin-private-owner-installation-2026-10-26.md) مرجع وضعیت فعلی است. این سند سابقهٔ آماده‌سازی پیش از نصب است. بکاپ واقعی و ایجاد حساب هنوز اجرا نشده‌اند.

## نتیجه و حدود اجرا

[ADR-084](../adr/084-staging-owner-private-ssh-ceremony.md) و [روش اجرایی](../operations/admin-owner-staging-ceremony.md) مرجع جدیدند. الزام دو Ed25519 در کد قبلی وجود داشت؛ برای Staging با پروفایل صریح SSH/root/TTY، تأیید تعاملی، authority محدود به عمل، checkpoint بیرون DB و Audit خصوصی بازطراحی شد. این fallback برای امضای گم‌شده نیست؛ composer قدیمی Staging را رد می‌کند و سایر محیط‌ها مسیر قبلی را دارند.

**هیچ حساب یا credential واقعی ساخته/دریافت نشد. هیچ نصب، تغییر فایل/role/grant/schema، backup یا restore روی سرور انجام نشد.** فقط پیش‌نیاز executable و descriptor اتصال/TLS سرور خواندنی بررسی شدند؛ secret چاپ نشد. تمام fixtureها و restoreها متعلق به Docker محلی و یک‌بارمصرف بودند. Public Admin و فاز دو فعال نشدند.

## تغییرهای آماده

- `admin-owner-staging.ts`: entrypoint خصوصی Bootstrap/Recovery، ورودی بدون echo و تکرار secret، رد pipe/debug/core dump، policy/role دقیق Staging، تأیید همان عمل، کنترل evidence/maintenance و receipt تازهٔ backup. secret در argv، فایل درخواست، خروجی یا Audit قرار نمی‌گیرد.
- `admin-owner-private.ts` و `admin-owner-state.ts`: permission و والد امن/no-follow، lock انحصاری، checkpoint اتمیک/fsync، Audit با allowlist، authority حافظه‌ای پنج‌دقیقه‌ای و HMAC digest درخواست نرمال‌شده. restore قبل enrollment، owner متفاوت و replay با digest جدید بسته‌اند؛ commit مبهم pending را حفظ می‌کند.
- `application/provisioning.ts`: فقط در profile خصوصی Staging، Recovery به Password فعلی مالک نیاز دارد و credentialVersion زیر lock دوباره بررسی می‌شود. Password/identity حفظ و PIN/lock و epochها همراه receipt/Audit اتمیک‌اند. Password غلط تلاش PIN اضافه نمی‌کند. تمام FULL/PENDINGهای قبلی پس از بازیابی نامعتبرند.
- `admin-owner-backup*.ts`: pg_dump شش جدول با TLS کامل و سقف حجم/deadline؛ dump، checkpoint و capsule کلیدها/config با AES-256-GCM و scrypt پیش از نوشتن رمزگذاری می‌شوند. عبارت decrypt مستقل و تعاملی است؛ dump/env خام در فایل موقت نیستند.
- `admin-owner-restore*.ts`: کپی شخصی خارج SSH، تأیید AEAD پیش از SQL، container تازهٔ Docker محلی بدون شبکه/port/host volume و دادهٔ tmpfs، schema/grant بازبینی‌شده و restore تراکنشی، بررسی owner/رابطه‌ها/trigger/privilege، cleanup و سپس receipt. target URL/container موجود پذیرفته نمی‌شود و دیتابیس سرویس‌دهنده restore نمی‌شود.
- `admin-staging-owner-permissions.sql`: فقط SELECT دو جدول session/grant برای role خصوصی recovery موجود؛ از grants عادی جداست و در حضور realm دیگر رد می‌شود. runtime، roleهای بازی و HBA گسترش نمی‌یابند. migration اضافی برای این بازطراحی ساخته نشد؛ Password change به migration/grant آماده‌شدهٔ قبلی فاز یک وابسته است.
- scripts واقعی `admin:owner:staging`، `admin:owner:backup`، `admin:owner:restore-test` و `test:admin:private` و gate تست خصوصی در CI اضافه شدند؛ CI راه‌دور اجرا نشده است.

## یافتهٔ خواندنی سرور

host فعلی Node/pnpm/pg_dump/pg_restore ندارد. URLهای runtime و roleهای خصوصی به نام `postgres-staging` و CA داخل `/run/` اشاره می‌کنند که روی host وجود ندارند. policy ابزار host-based صریحاً IP خصوصی `10.89.18.20:5432` و CA موجود `/opt/hambazi/private/tls/data-ca.pem` را تعیین می‌کند؛ credential/نام DB و `verify-full` حفظ می‌شوند. گواهی PostgreSQL همین IP را در SAN دارد و probe فقط‌خواندنی STARTTLS از host با CA/verify_ip، TLS 1.3 و `Verification: OK` موفق بود. DNS، `/etc/hosts`، certificate، HBA و Firewall تغییر نکردند.

HBA نصب فعلی runtime/reader را به IP کانتینر Admin و bootstrap/recovery را به gateway میزبان محدود می‌کند. بنابراین backup میزبان از role خصوصی recovery استفاده می‌کند؛ فقط دو SELECT تکمیلی در فایل مخصوص Staging آماده‌اند و هنوز روی سرور اعمال نشده‌اند. role نوشتنی قبلاً اختیار Recovery داشت؛ این reuse برای اپراتور root همان میزبان tradeoff صریح است، نه ادعای readonly بودن role یا اعتبارسنجی Password/SSH داخل PostgreSQL.

## شواهد محلی

| بررسی                             | نتیجه                                                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API unit/security                 | ۶۱ فایل، ۱۰۴۹ موفق؛ شامل ۱۳ تست جدید profile/TTY/checkpoint/receipt/password fence/AEAD و پوشش قبلی تغییر Password/PIN                                                 |
| integration اصلی PostgreSQL/Redis | ۱۲ موفق؛ singleton، قفل پایدار پس از restart، grants، race، Audit rollback و Password change/ابطال نشست‌ها                                                             |
| rehearsal جدید                    | چهار موفق: snapshot خالی قبل OWNER با خود CLI و PTY، bootstrap همزمان و lock، dump رمزگذاری‌شده/restore جدا، بازیابی همان identity با Password و revoke/Audit rollback |
| مرز grant مخصوص Staging           | در fixture دارای realm دیگر رد شد و SELECTهای اضافی برای recovery آن محیط ایجاد نشدند؛ در دو DB مخصوص Staging صریحاً اعمال شدند                                        |
| فایل/ترمینال واقعی                | root در container شبکه‌بسته: symlink/hardlink، permission/والد، lock، Audit، expiry/maintenance؛ PTY واقعی: نبود echo، UTF-8، cancel و بازگشت حالت terminal            |
| Browser                           | شش E2E موفق؛ login/lock/revoke، RTL/accessibility و تغییر هر دو secret با پاک‌شدن فرم و برگشت به login                                                                 |
| Infra                             | ۲۱ فایل، ۱۹۲ موفق، دو skip موجود                                                                                                                                       |
| کیفیت                             | frozen install، buildهای API/Admin، typecheckهای API/Admin، lint، architecture و قراردادها موفق                                                                        |
| supply chain                      | dependency scan صفر finding؛ pnpm deploy مستقل مطابق policy؛ gitleaks artifact با binary تأییدشده و بدون استثنای جدید صفر finding                                      |

این‌ها تست روی OWNER واقعی نیستند. Browser با mock قرارداد و backend/DB جدا با fixture واقعی آزموده شدند. runnerها Docker را به Unix socket محلی مقید می‌کنند؛ context راه‌دور یا URL دیتابیس کاربر پذیرفته نمی‌شود.

شکست‌های توسعه مربوط به port تازه پس از restart، جایگزینی متنی URL و نبود stdin تعاملی Docker، با خواندن binding جدید، URL API و `--interactive` اصلاح شدند. شروع PostgreSQL sandbox بیش از timeout پیش‌فرض واحد طول کشید؛ فقط integration همان عملیات timeout متناسب گرفت و container باقیماندهٔ همان آزمون پاک شد. cleanup وقفه/خروج محدود به نام یکتای همان container است. lint خطای finally را نیز شناسایی کرد؛ نتیجه/خطا اکنون پس از cleanup ارزیابی می‌شود. assertion یا سیاست امنیتی برای عبور تست حذف نشد.

`pnpm check` سراسری، CI راه‌دور یا scan تمام تاریخچهٔ Git سبز اعلام نمی‌شوند؛ مسائل قبلی Web SSR و provenance exception خارج این اصلاح‌اند. اسکن artifact و تست محلی جای qualification image/OS/runtime واقعی مقصد نیستند.

## بسته و gateهای باقی‌مانده

بستهٔ محلی `/home/mehdi/.cache/hambazi-admin-owner/candidate-hnptkx_k/` شامل API مستقل با وابستگی production، client و SQLهای لازم است. تمام symlinkها داخل بسته‌اند و credential/policy/checkpoint واقعی در آن نیست. native Argon2 برای Password/PIN و layout SQL روی bundle smoke شدند. `candidate-manifest.json` digest همان نسخه را ثبت می‌کند؛ پس از تغییر باید hash/scan تازه ساخته شود. این artifact مجوز نصب یا image واجد شواهد سرور نیست.

پیش از حساب واقعی الزاماً باقی‌اند:

1. مجوز نصب نسخهٔ دقیق و ابزار خصوصی؛ نصب/qualification Node و client PostgreSQL، image scan و health/evidence واقعی، migration/narrow grants فاز یک، SELECTهای مخصوص Staging، host connection smoke و policy ریشه‌ای. سایر سرویس‌ها عمومی یا بازطراحی نشوند.
2. backup واقعی محیط، عبارت decrypt مستقل در vault خارج VPS، کپی رمزگذاری‌شده بیرون سرور و restore-test موفق همان کپی با همین نسخه؛ receipt تازه و hash برابر نصب شود. backup/تاریخچهٔ لازم vault پس از تغییر Password به‌روز شوند. receipt fixture جای رسید محیط واقعی نصب نشود.
3. تأیید مشخص ساخت نخستین OWNER؛ سپس فقط مالک در SSH/TTY خصوصی Username، Password و PIN خودش را وارد کند. پس از enrollment، checkpoint و backup تازه خارج DB/VPS نگه‌داری شوند.

Password+PIN ثابت MFA مستقل نیست؛ root مخرب یا گم‌شدن همزمان vault/SSH/backup خارج توان RBAC‌اند. Recovery این profile Password گم‌شده را reset نمی‌کند. این محدودیت‌ها با حذف دو کلید پنهان نشده‌اند.

**توقف:** حساب واقعی، deployment، اجرای backup سرور، public ingress و فاز دو انجام نشدند؛ ادامهٔ اجرایی مجوز جدا می‌خواهد.

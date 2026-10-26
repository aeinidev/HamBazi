# HamBazi Admin Dashboard — گزارش و راهنمای فاز یک

> **پایان فاز یک در Staging — ۲۷ اکتبر:** OWNER واقعی، ورود Public HTTPS، تغییر Password، ابطال نشست‌های قبلی و بکاپ نهایی پس از تغییر رمز با restore واقعی خارج سرور تأیید شده‌اند. PIN واقعی حفظ شد و تغییر آن فقط ایزوله آزموده شد. [گزارش پایان فاز یک](admin-phase-1-finalization-2026-10-26.md) و [گزارش انتشار عمومی](../operations/admin-public-https-staging-20261027.md) مرجع شواهد و حدود پذیرش‌اند. بندهای زیر که نصب/حساب/انتشار را انجام‌نشده می‌دانند تاریخی‌اند. فاز دو آغاز نشده و به تأیید صریح جدید نیاز دارد.

> **تصمیم جدید مراسم Staging — [ADR-084](../adr/084-staging-owner-private-ssh-ceremony.md):** دو امضای Ed25519 و فایل credential خام برای Staging با پروفایل صریح SSH/root/TTY، تأیید عمل، checkpoint و Audit خصوصی جایگزین می‌شوند؛ Recovery به Password فعلی همان OWNER نیاز دارد. backup رمزگذاری‌شده و تمرین restore خارج سرور پیش‌نیازند. این تغییر محلی است؛ نصب، حساب واقعی، public ingress و فاز دو مجاز نشده‌اند. مطالب قبلیِ دو proof در این محدوده تاریخی‌اند؛ برای محیط‌های دیگر پابرجا هستند.

> **آماده‌سازی جدید، بدون تغییر سرور:** [گزارش Public HTTPS](admin-public-https-preparation-2026-10-26.md) و [ADR-083](../adr/083-admin-public-https-and-self-credential-rotation.md) مرجع کد جدید ورود عمومی و self-service Password/PIN هستند. وضعیت‌های این سند سابقهٔ زمان گزارش‌اند؛ کد جدید هنوز مستقر نشده و gateهای Bootstrap/Recovery واقعی و مجوز انتشار باقی‌اند.

تاریخ: ۲۰۲۶-۱۰-۲۵. محدودهٔ مجاز: **هویت محلی و پنل مشاهده** طبق ADR-039/078/079/080 و بازنگری احراز هویت در [ADR-081](../adr/081-admin-local-password-and-owner-pin.md). این سند مجوز مرحلهٔ بعد یا استقرار نیست.

**به‌روزرسانی پس از گزارش محلی:** مالک بعداً انتشار و مسیر «فقط تونل SSH» را صریحاً تأیید کرد. نصب بدون حساب فاز یک اکنون منتشر شده است؛ نتیجهٔ واقعی، راهنمای اتصال و محدودیت‌ها در [گزارش انتشار ۲۶ اکتبر](admin-private-deployment-2026-10-26.md) ثبت شده‌اند. عبارت‌های «استقرار انجام نشده/فعال‌سازی بسته» در ادامه، وضعیت زمان گزارش محلی‌اند؛ شکست‌های check سراسری همچنان حل‌شده اعلام نمی‌شوند. OWNER واقعی و فاز دو اجرا نشده‌اند.

**آمادگی حساب واقعی:** [بازبینی OWNER](admin-owner-readiness-2026-10-26.md) مشخص می‌کند که CLI فعلی فایل‌محور است، تغییر PIN موجود است اما تغییر Password وجود ندارد و custody/recovery عملیاتی هنوز کامل نیست. درخواست اطلاعات اولیهٔ «موقت» هیچ‌یک از این gateها را حذف نمی‌کند.

## نتیجه و مرز فاز

پنل مستقل `apps/admin` و entry point اختیاری Admin از همان کد/API artifact ساخته شده‌اند. رابط بازیکن، session بازیکنان، engine و writer بازی تغییر نکرده‌اند. Admin به PostgreSQL و Redis فعلی با role، namespace، pool و سقف هزینهٔ جدا متصل می‌شود؛ DB یا سرویس دامنهٔ جدیدی ساخته نشده است. استقرار process، DNS، Nginx، TLS واقعی و server unit انجام نشده‌اند.

این فاز مدیریت مدیران/نقش‌ها، تولید رمز دوازده‌کاراکتری، دعوت، reset سایر مدیران، OWNER_FINAL، approval، تغییر availability، terminate/close، تنظیمات و Feature Flags را اجرا نمی‌کند؛ آن‌ها خروجی فاز دو هستند. moderation، گزارش محتوایی، آمار پیشرفته و مالی نیز فعال نشده‌اند. هیچ route عمومی Signup/Forgot/Unlock/Bootstrap وجود ندارد. حساب واقعی OWNER ساخته نشده است.

## تغییر معماری نسبت به طرح قبل

| موضوع              | قبلی                          | تصمیم و اجرای فعلی                                                                      |
| ------------------ | ----------------------------- | --------------------------------------------------------------------------------------- |
| ورود               | OIDC/MFA خارجی                | Username/Password محلی، بدون سرویس هویت خارجی                                           |
| مالک               | subject خارجی و authenticator | binding یکتای حفاظت‌شده و PIN ثابت شش رقم پس از password                                |
| assurance          | MFA مقاوم به phishing         | password + PIN ثابت دو knowledge secret؛ **MFA مستقل یا مقاوم به phishing نیستند**      |
| قفل                | سیاست provider                | شمارندهٔ سراسری هر OWNER در PostgreSQL؛ failure سوم قفل دائمی تا recovery خصوصی         |
| recovery           | provider/passkey              | ابزار خصوصی OS root، دو امضای مستقل Ed25519 و credential DB محدود                       |
| credential storage | ممنوعیت کلی hash              | فقط verifier مستقل Argon2id در جدول‌های امنیتی Admin؛ raw credential/telemetry ممنوع    |
| process            | امکان process مشترک           | entry point اختیاری جدا از همان artifact برای محدودکردن KDF/credential؛ هیچ deploy جدید |
| OWNER/RBAC/دامنه   | مطابق ADR-079                 | بدون تغییر؛ مالک فقط در entitlement تمام قابلیت‌های ثبت‌شده را دارد                     |

## فایل‌ها و مسئولیت‌ها

- `apps/admin`: React/Vite، فارسی/RTL، فونت محلی موجود، Midnight Neon، ورود مشترک، PIN، خروج، تغییر PIN مالک، navigation مجاز، فهرست/جزئیات metadata و monitoring/audit محدود؛ بدون Telegram SDK و credential در storage مرورگر.
- `apps/api/src/admin`: domain capability/scope، کاربردهای login/PIN/session/change-PIN/provisioning، repository اختصاصی، crypto، قرارداد و private HTTP adapter.
- `apps/api/src/composition/admin-*`: assembly و lifecycle خصوصی؛ public API composition هیچ Admin controller یا startup خودکار ندارد.
- Users/Games/Rooms/Matches: read port عمومی هر owner، select صریح metadata، pagination حداکثر ۵۰ و scope بازی؛ بدون stateJsonb، کارت، deck، chat، inviteCode یا شناسهٔ Telegram.
- `packages/config/src/admin.ts`: تنظیم صریح و fail closed؛ `packages/validation/src/admin.ts`: پاسخ‌های strict؛ `docs/contracts/admin.openapi.json` و baseline: قرارداد اجرایی مستقل از player API.
- Prisma migration افزایشی `202610250001_admin_local_identity` و `admin-permissions.sql`: فقط fixture محلی اعمال شده‌اند؛ workflow معمول API/Worker هیچ grant مدیریتی دریافت نمی‌کند.

## مدل داده و credential

| مدل اجراشده           | کاربرد                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `admin_realms`        | binding یک OWNER و ownershipEpoch/policyRevision؛ rebind/delete از CRUD ممنوع                                                          |
| `admin_operators`     | username canonical یکتا در realm، verifierهای مستقل، status، credentialVersion/sessionEpoch/authorizationVersion، pinFailures/lockedAt |
| `admin_sessions`      | فقط metadata PENDING/FULL، تاریخ‌ها و epoch؛ token خام ذخیره نمی‌شود                                                                   |
| `admin_auth_receipts` | commandId یکتا برای actor، digest keyed و outcome/reference؛ append-only                                                               |
| `admin_grants`        | snapshot پایهٔ grant فردی، environment، game scope و DENY؛ هیچ CRUD عمومی در این فاز                                                   |
| `admin_audit_events`  | eventهای allowlisted و content-free، actor/reference/time؛ UPDATE/DELETE/TRUNCATE ممنوع                                                |

OWNER یک role قابل انتساب نیست. نام/شناسه/اطلاعات ورود واقعی در source، migration یا example قرار ندارند. هر محیط database/realm و credential مستقل دارد؛ ایجاد realm جایگزین برای دورزدن یکتایی مالک عملیات مجاز نیست. DBA/superuser یا OS root مخرب خارج trust برنامه‌اند؛ append-only ادعای مصونیت از آن‌ها نیست.

Role templates، bindings و editor مربوط به فاز دو هستند. grants موجود در هر gate از primary خوانده می‌شوند؛ نقش‌های عادی default deny و DENY غالب‌اند. ترکیب global ALLOW و game-specific DENY فعلاً محافظه‌کارانه کل read را رد می‌کند؛ پشتیبانی NOT IN و preview دقیق باید پیش از فعال‌سازی editor در فاز دو تکمیل شود. سقف snapshot ۲۵۶ grant است و overflow fail closed است؛ OWNER از grantهای عادی مستقل است. قابلیت ثبت‌نشده برای همه رد می‌شود؛ ثبت قابلیت جدید در release برای OWNER خودکار مجاز و برای دیگران explicit است.

## پروتکل ورود و نشست

۱. password با Argon2id خارج تراکنش و سقف همزمانی بررسی می‌شود؛ unknown username از verifier ساختگی هم‌هزینه استفاده می‌کند. خطای username/password عمومی است؛ PIN counter تغییر نمی‌کند.
۲. در transaction کوتاه، lock اختصاصی realm و recheck credential/status انجام می‌شود. مدیر عادی FULL و مالک PENDING می‌گیرد. PENDING کوتاه‌عمر هیچ Admin authority ندارد.
۳. PIN با pepper خارج DB و Argon2id بررسی، سپس زیر lock نتیجه با credential/session version و root binding fence می‌شود. wrong PIN با receipt/Audit اتمیک شمرده می‌شود؛ commandId تکراری یک intent است. سومین failure هم lock و هم epoch جدید را commit می‌کند. قبل از lock، موفقیت کامل شمارنده را صفر و PENDING را revoke و FULL تازه صادر می‌کند.
۴. هر gate نشست/status/epoch/expiry/idle و grant جاری را از primary بررسی می‌کند. JWT فقط reference/type دارد، نه authority role. logout/change-PIN/recovery نشست‌ها را به‌صورت durable بی‌اعتبار می‌کنند. تغییر PIN به password و PIN فعلی نیاز دارد؛ password غلط شمارندهٔ PIN را افزایش نمی‌دهد.
۵. Secure/HttpOnly/SameSite=Strict host cookies، CSRF متصل به نشست، Origin/Host دقیق، TLS و peer allowlist اعمال می‌شوند. ورود به نوع دیگر، cookie قبلی را پاک می‌کند. Authorization و identity forwarding ارسالی client پذیرفته نمی‌شوند.

مرورگر در foreground هر پنج ثانیه و هنگام visibility change مجوز را بازبینی می‌کند؛ تغییر revision دادهٔ قدیمی را پاک و دوباره read می‌کند. polling دسترسی idle را تمدید نمی‌کند. نشست غیرفعال یا خطای اعتبارسنجی رابط را به Login برمی‌گرداند. در فاز یک stream/Socket مدیریتی وجود ندارد. gate جدید stale authz ندارد؛ پاسخ از قبل admitted ممکن است تا timeout محدود درخواست کامل شود و revoke، دادهٔ قبلاً دیده‌شده را از حافظهٔ انسان پس نمی‌گیرد. سنجش چند node در شبکهٔ واقعی همچنان gate محیط است.

## APIهای موجود

همه زیر `/v1/admin`، روی listener خصوصی مستقل؛ پاسخ خطا generic و machine-readable است.

| مسیر                                                  | رفتار                                                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/login`                                    | username/password؛ فقط next و CSRF در body، credential در cookie امن                                                       |
| `POST /auth/pin`                                      | pending cookie + CSRF؛ شش رقم و commandId                                                                                  |
| `GET /me/access`، `GET /session`                      | دسترسی مؤثر/نسخه‌ها و metadata نشست خود                                                                                    |
| `POST /auth/logout`                                   | revoke durable؛ cookie پاک                                                                                                 |
| `POST /auth/pin/change`                               | فقط OWNER، password/currentPin/newPin؛ revoke همهٔ نشست‌های پیشین                                                          |
| `GET /users`، `/games`، `/rooms`، `/matches` و `/:id` | فهرست cursorدار و جزئیات metadata؛ عدم وجود/خارج scope در جزئیات، صفحهٔ خالی؛ Match فقط نسخه‌های ثابت اجرا را اضافه می‌کند |
| `GET /overview`، `/monitoring/summary`                | snapshot محدود diagnostics ownerها، coalesced پنج‌ثانیه‌ای، asOf/source/validity؛ بدون جعل آمار مالی/CCU                   |
| `GET /audit-events`                                   | آخرین ۵۰ event امنیتی بدون credential؛ history/filter کامل در فازهای بعد                                                   |

registry فاز یک فقط viewهای اجراشده را ثبت می‌کند. monitoring/overview/audit و users فقط با scope سراسری مجازند تا aggregate/PII خارج محدوده نشت نکند. جزئیات Match خارج game scope نیز هیچ metadata نمی‌دهد. query ناشناخته و page size بیش از ۵۰ رد می‌شوند. audit خطای Auth به‌معنی ثبت read-access همهٔ صفحات نیست؛ audit عملیات محصول و ممیزی تفصیلی در فاز دو گسترش می‌یابند.

## راه‌اندازی و بازیابی — فقط پس از تأیید جدا

این بخش شرح ابزار است، دستور اجرای حساب واقعی در این نوبت نیست. ابتدا private route/TLS/peer inventory، زمان‌ها، key custody و recovery drill، retention و مجوز محیط باید بسته شوند.

`start:admin` و `admin:provision` در manifest واقعی API ثبت شده‌اند. Admin به‌صورت پیش‌فرض disabled است؛ public API آن را اجرا نمی‌کند. ابزار provisioning در startup اجرا نمی‌شود؛ به OS root، flag صریح `--confirm-private-owner-ceremony`، فایل‌های absolute/root-owned محدود با والدهای غیرقابل‌نوشتن عمومی و proof معتبر نیاز دارد. هیچ secret در argv/stdout قرار نمی‌گیرد.

فایل درخواست خصوصی با `ADMIN_CEREMONY_REQUEST_FILE` و proof با `ADMIN_CEREMONY_PROOF_FILE` معرفی می‌شوند. کلیدهای عمومی مورد اعتماد با `ADMIN_OPERATOR_PUBLIC_KEY_FILE` و `ADMIN_OWNERSHIP_PUBLIC_KEY_FILE` از custody مستقل خارج DB می‌آیند. دو private signing key باید در اختیار دو authority مستقل (اپراتور سرور و مالک پروژه، که می‌توانند همان انسان با custody جدا باشند) و خارج runtime باشند. داشتن فایل DB dump یا runtime DB URL کافی نیست.

Bootstrap: schemaVersion=1، commandId، username/password/pin انتخاب‌شدهٔ مالک، confirmed=true، reasonCode=INITIAL_OWNER_ENROLLMENT. Recovery: schemaVersion=1، commandId، username همان مالک، PIN جدید، confirmed=true، reasonCode=OWNER_PIN_RECOVERY؛ password تغییر نمی‌کند و در DTO recovery پذیرفته نمی‌شود.

statement قابل امضا با `adminProvisioningStatement` یک آرایهٔ JSON canonical با domain separator، commandId، realmId، username، reasonCode، digest keyed از DTO parse‌شده، issuedAt و expiresAt است؛ عمر حداکثر پنج دقیقه. proof شامل همان فیلدها و دو امضای base64url Ed25519 است. adapter امضاکننده/تحویل فایل و custody واقعی باید قبل ceremony qualify شود؛ ابزار فعلی نه key تولید می‌کند و نه حساب پیش‌فرض. request خام پس از ceremony باید طبق runbook خصوصی حذف شود؛ secret وارد Git یا گزارش نشود.

DB roles باید توسط اپراتور و با secretهای متفاوت provision و سپس grants جدا review شوند:

- `hambazi_admin_runtime`: هویت/نشست و evidence پایه؛ نه role/grant/ساخت مدیر یا game write. trigger مانع رفع lock توسط این role می‌شود.
- `hambazi_admin_reader`: SELECT ستون‌های metadata مشخص در ownerها؛ نه hidden state، chat یا credential بازیکن.
- `hambazi_admin_bootstrap`: ایجاد binding اولیه و evidence همان ceremony؛ پس از نصب خارج runtime.
- `hambazi_admin_recovery`: تغییر PIN/lock/epoch همان root از ابزار خصوصی؛ credential در runtime نیست. دسترسی این role privileged است و باید خارج دسترسی عادی DB و با custody مستقل حفاظت شود؛ SQL به‌تنهایی امضاهای بیرونی را validate نمی‌کند، ابزار مرجع پذیرش proof است.

قفل در PostgreSQL پس از restart باقی است. recovery همان ID/root را حفظ، PIN تازه و pinFailures=0/lockedAt=null ثبت، credentialVersion/sessionEpoch/ownershipEpoch را افزایش و همهٔ pending/full نشست‌های قبلی را نامعتبر می‌کند. Audit failure همه را rollback می‌کند. recovery عمومی، auto unlock، reset توسط Super Admin یا override مخفی وجود ندارد.

## تنظیمات لازم و تصمیم‌های هنوز باز

تمام تنظیمات `parseAdminConfig` صریح‌اند: ADMIN_ENABLED، REALM/ENVIRONMENT/ORIGIN، BIND_ADDRESS/PORT/PRIVATE_PEERS، DATABASE_URL/READ_DATABASE_URL/DB_POOL_MAX، SESSION_SECONDS/IDLE_SECONDS/PENDING_SECONDS، SIGNING_KEY/PIN_PEPPER/COMMAND_KEY، ISSUER/AUDIENCE، ARGON_MEMORY_KIB/ARGON_TIME/CRYPTO_CONCURRENCY/MAX_IN_FLIGHT، TLS_KEY_FILE/TLS_CERT_FILE، RATE_LIMIT/REDIS_URL (همه با پیشوند ADMIN_). secret wrapper مانع serialization اتفاقی است. production به PostgreSQL با sslmode=verify-full و Redis TLS نیاز دارد؛ roleهای runtime/reader در assembly validate می‌شوند. Argon2 parameters، حافظهٔ process و latency باید روی host واقعی سنجیده شوند؛ مثال‌های تست سیاست production نیستند.

D01 فاز صفر با درخواست صریح مالک به Local Auth بسته شد. provider/assurance خارجی حذف شد، اما ریسک knowledge-only پذیرفته و مستند است. private network محصول منتخب، TLS/ingress واقعی، session durationهای محیط، retention/archive/checkpoint/alert، key custody/rotation/backup، proof preparation، restore reconciliation و بودجهٔ بار مشترک هنوز gate هستند. تغییر پارامتر KDF یا pepper بدون برنامهٔ سازگاری می‌تواند verifierهای قدیمی را نامعتبر کند؛ rotation واقعی قبل استفادهٔ انسانی باید rehearsed شود. dump و host/root compromise هم‌زمان با pepper خطر PIN آفلاین را بازمی‌گرداند. سرقت password امکان قفل عمدی مالک با سه failure را ایجاد می‌کند.

## برنامه و شواهد تست

تست‌ها فقط با دادهٔ مصنوعی اجرا شده‌اند. runner محلی هیچ URL هدف از کاربر قبول نمی‌کند؛ PostgreSQL/Redis pinned با نام تصادفی، loopback، credential تصادفی و volume اختصاصی می‌سازد، migration را دو بار اعمال و در پایان فقط منابع متعلق به خودش را پاک می‌کند. restart واقعی PostgreSQL و بازسازی repository برای lock بررسی می‌شود. HTTPS تست با certificate مصنوعی و CA validation واقعی انجام می‌شود. browser E2E روی bundle ساخته‌شده با پاسخ‌های مصنوعی API است؛ این تست به‌تنهایی evidence Backend نیست و با integration جدا تکمیل شده است.

| بررسی                                              | نتیجهٔ محلی                                                                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                   | موفق، ۱۷ پروژهٔ workspace                                                                                                                            |
| format/lint/architecture                           | موفق؛ ۱۶ workspace و ۳۲۷ source file در architecture gate                                                                                            |
| `pnpm typecheck` (در check)                        | تمام ۲۵ task موفق                                                                                                                                    |
| `pnpm build`                                       | تمام ۱۴ build task موفق، شامل bundle مستقل Admin و Web                                                                                               |
| API unit/security suite                            | ۵۸ فایل و ۱۰۲۹ تست موفق؛ ۱۴ تست اختصاصی Admin                                                                                                        |
| config                                             | ۱۹ فایل و ۲۷۷ تست موفق؛ سه تست جدید تنظیم Admin                                                                                                      |
| browser Admin                                      | چهار E2E موفق روی bundle ساخته‌شده، RTL، موبایل/دسکتاپ، axe، CSP بدون eval، XSS، عدم storage، مسیر OWNER/مدیر و revoke ≤۵s                           |
| `test:admin:local`                                 | ۱۱ integration موفق با PostgreSQL/Redis واقعی و HTTPS مصنوعی؛ قفل/retry/concurrency/recovery/restart/grants/audit rollback/read scope/rate namespace |
| architecture rule fixtures                         | ۱۷۴ تست موفق، شامل مرز Admin/owner/Frontend و منع query دادهٔ بازی از Admin                                                                          |
| `pnpm test:infra` با include صریح                  | ۱۸ فایل؛ ۱۷۴ موفق و دو skip موجود؛ بدون اجرای نسخه‌های آرشیوی test-results                                                                           |
| API `contract:check`                               | همهٔ قراردادهای فعلی و Admin موفق؛ baseline مستقل و drift/compatibility check                                                                        |
| dependency scan                                    | پس از patch، صفر finding در همهٔ severityها                                                                                                          |
| `turbo run test --concurrency=1 --continue=always` | ۳۸ task موفق از ۳۹؛ فقط Web شکست؛ تست‌های دیگر از جمله engineها، Bot، Worker و Admin تکمیل شدند                                                      |
| `pnpm check`                                       | **سبز نیست**؛ سه failure در تست‌های فعلی Web، شرح پایین                                                                                              |
| secret scan با Gitleaks pinned تأییدشده            | **blocked**؛ finding قدیمی در history/current، شرح پایین                                                                                             |

دور اول check موازی روی این میزبان چهار timeout پنج‌ثانیه‌ای در تست‌های موجود TypeScript presets داشت؛ اجرای serial همان suite را گذراند و timeoutها تضعیف نشدند. سه تست `apps/web/tests/unit/owner-staging.test.tsx` در SSR به‌جای lobby/profile، LoadingScreen می‌گیرند؛ همین سه failure با Vitest قبلی 5.0.0 نیز بازتولید شدند (۶ موفق/۳ ناموفق در همان فایل). source و تست بازیکن در این فاز تغییر نکرده‌اند؛ بنابراین check سراسری به‌عنوان موفق گزارش نمی‌شود.

اسکن secret ابتدا بدون مسیر ابزار در setup متوقف شد؛ سپس binary pinned تأییدشدهٔ Gitleaks 8.30.1 استفاده شد. policy اسکن، یک finding بررسی‌نشده در history و یک finding در current دارد؛ current روی فیلد `api` در `infra/docker/staging/staging-test-user-current.json:1967` است و از قبل در HEAD وجود دارد. مقدار match/secret در گزارش یا خروجی ابزار نمایش داده نشد. این یک finding اسکنر است و واقعی‌بودن secret بدون review نتیجه‌گیری نشده است؛ suppress/allowlist جدیدی اضافه نشد و فایل Staging تغییر نکرد. این gate پیش از انتشار نیازمند بررسی مستقل است.

نسخه‌های اصلاحی بسته‌های مشترکِ مورد استفادهٔ Admin نیز در lockfile تثبیت شدند: Vite 8.3.5، Vitest 5.0.5، Fastify 5.12.7 و overrides مربوط به fast-uri 3.1.9/4.2.3. major version تغییر نکرد. این اقدام برای رفع findingهای اسکن بود؛ منطق محصول سایر appها تغییر نکرد. منابع upstream بررسی‌شده: [Vite](https://github.com/vitejs/vite/releases/tag/v8.3.5)، [Vitest](https://github.com/vitest-dev/vitest/releases/tag/v5.0.5)، [Fastify](https://github.com/fastify/fastify/releases/tag/v5.12.7)، [fast-uri advisory](https://github.com/advisories/GHSA-w74x-v6f9-j3xg).

در اجرای infra مشخص شد فیلتر نام ساده، نسخه‌های قدیمی تست را از درخت آرشیویِ ignored زیر test-results نیز اجرا می‌کند. config مستقل `infra/vitest.config.mjs` با include دقیق `infra/tests/**/*.test.mjs` اضافه شد؛ فایل‌های آرشیوی حذف یا ویرایش نشدند و assertionهای تست‌های اصلی حفظ شدند. انتظار شمار migration در تست inventory به ۱۶ افزایش یافت، چون migration جدید همین فاز اکنون بخشی از source است.

fixture restart ابتدا در بازاتصال به port موقت Docker ناپایدار بود؛ readiness اکنون port جاری را هر بار می‌خواند و قبل ساخت repository منتظر اتصال واقعی می‌ماند. شکست‌های اولیه پنهان نشدند؛ نتیجهٔ نهایی suite ۱۱/۱۱ است و منابع موقت پاک شده‌اند. حدود evidence: تست بار مشترک/soak، حساب واقعی، private ingress مستقر، key custody انسانی، recovery روی سرور، container qualification و Staging/Production اجرا نشده‌اند. CI، integration محلی Admin و browser gate را اجرا خواهد کرد؛ تعریف workflow به معنی اجرای موفق CI راه‌دور نیست.

## آمادگی و توقف

**وضعیت: پیاده‌سازی محلی هویت و مشاهده انجام شده؛ پذیرش سراسری و فعال‌سازی بسته است.** خروجی فاز یک فقط برای review/توسعهٔ محلی است. دو مانع موجودِ تست Web و secret-scan و gateهای محیط قبل از ادعای readiness انتشار باید حل شوند. عملیات محصول و مدیریت مدیران برای فاز دو برنامه‌ریزی شده و هنوز فعال نیستند. ورود به فاز دو فقط با تأیید صریح مالک پس از گزارش این فاز مجاز است؛ هیچ مجوز ضمنی از «continue» برای مرحلهٔ بعد برداشت نمی‌شود. ایجاد حساب واقعی یا تغییر Staging/Production تأیید جدا و بستن gateهای محیط را می‌خواهد.

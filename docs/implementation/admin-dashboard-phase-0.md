# HamBazi Admin Dashboard — گزارش فاز صفر

تاریخ بررسی: ۲۰۲۶-۱۰-۲۵، منطقهٔ زمانی گزارش Asia/Tehran.

**وضعیت تحویل:** بررسی مخزن، inventory، تحلیل امنیت، قرارداد مفهومی، تصمیم‌نامه و برنامهٔ پذیرش فاز صفر تکمیل شده‌اند. **Gate ورود اجرایی به فاز یک: بسته**؛ انتخاب‌های محیطی باز و تأیید صریح فاز بعد لازم است. این گزارش تکمیل پیاده‌سازی، انتخاب provider یا مجوز استقرار نیست.

## ۱. دامنه و مجوز همین نوبت

درخواست فعلی فقط فاز صفر جدول بخش ۱۲ [معماری پنل](../architecture/admin-dashboard.md) را مجاز کرده است: inventory، threat model، ADR، scope نقش‌ها، KPI و تصمیم‌های IdP/network/session/retention. در این فاز فایل محصول، workspace، dependency، migration، حساب، server، DNS یا deployment ساخته/تغییر داده نمی‌شود. پیاده‌سازی bootstrap/auth/UI متعلق به فاز یک است؛ mutationهای محصول و مدیریت مدیران متعلق به فاز دو هستند.

مالک در پاسخ به سؤال این فاز اعلام کرد: **«هنوز مشخص نیست؛ گزینه‌ها و معیار انتخاب را مستند کن»**؛ بنابراین عدم انتخاب IdP/private access یک تصمیم عمداً باز است، نه انتخاب ضمنی سرویس یا مانع انجام بررسی‌های مستقل.

این چرخهٔ Admin پس از گزارش **هر فاز متوقف می‌شود** و برای فاز بعد تأیید صریح لازم دارد. مجوزهای اجرای پیوستهٔ تاریخی در `docs/implementation-plan.md` برای چرخهٔ قدیمی MVP، مجوز ادامهٔ خودکار Admin نیستند. staging و production در هر مرحله تأیید صریح و جدا لازم دارند؛ تأیید کدنویسی یک فاز مجوز deployment آن نیست.

## ۲. baseline و صحت دامنه

- HEAD بررسی‌شده: `9f3f7a31af77624d1b46e17e1bd390d8d7c33f43`.
- در شروع این نوبت، شش سند Admin از کار قبلی در worktree موجود و هنوز commit نشده بودند: ADR-039 و سند امنیت modified؛ ADR-078/079 و دو سند معماری untracked. این‌ها محصول فاز صفر جدید محسوب نمی‌شوند و حفظ شدند.
- Node محلی `v24.20.0` و pnpm `12.4.1` با manifest سازگارند؛ `node_modules` از قبل وجود دارد. نصب یا ارتقای dependency برای این فاز لازم نیست.
- source، manifest، schema، grants و تعریف‌های استقرار نسخه‌شده بررسی شدند. هیچ اتصال SSH، درخواست به staging/production، دسترسی IdP واقعی یا مشاهدهٔ credential انجام نشده است. نتیجهٔ این فاز دربارهٔ سرور، **بازبینی تعریف و سابقه** است، نه تأیید وضعیت زنده.
- هیچ AGENTS.md اختصاصی زیر `docs` یافت نشد؛ قواعد ریشه و RTK اعمال شدند.

## ۳. inventory واقعی و مالک قابلیت‌ها

«موجود» یعنی در source قابل مشاهده؛ فعال‌بودن در محیط واقعی از آن نتیجه نمی‌شود. نام portهای جدید این جدول پیشنهاد قرارداد است و هنوز export نشده است.

| حوزه               | شاهد موجود                                                                                               | استفادهٔ مجدد                                       | شکاف لازم و فاز                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Frontend مدیران    | [manifest وب](../../apps/web/package.json)، React/Vite/TanStack Query/Zustand/Tailwind                   | stack، conventions، فونت/token مصوب                 | `apps/admin` و manifest/route/UI وجود ندارند؛ فاز ۱                                                |
| Backend Admin      | [index](../../apps/api/src/admin/index.ts) فقط `export {}`                                               | ساختار domain/application/infrastructure            | هویت/registry/guard/listener/assembly جدید؛ فاز ۱                                                  |
| هویت بازیکن        | [ADR-014](../adr/014-mini-app-session-strategy.md)، Auth و `sessions`                                    | الگوی validation، خطای امن و resource bounds        | session/key/audience بازیکن برای Admin reuse نمی‌شود؛ فاز ۱                                        |
| OWNER و مدیران     | ADR-079 و سند دسترسی                                                                                     | specification و AC-01…AC-22                         | binding/root/session/roles/audit tables و portها وجود ندارند؛ پایه فاز ۱، مدیریت فاز ۲             |
| Users              | [public index](../../apps/api/src/users/index.ts)، identity/profile/public names                         | مالکیت و projection نام‌ها                          | port فهرست/جزئیات Admin و جست‌وجوی bounded جدید؛ فاز ۱؛ restriction فاز ۳                          |
| Games              | [index](../../apps/api/src/games/index.ts)، catalog و `lobbyAvailability`                                | read و readiness/manifestهای موجود                  | overview واقعی چندبازی و منبع desired/effective؛ read فاز ۱، revision/fence فاز ۲                  |
| Rooms              | [index](../../apps/api/src/rooms/index.ts)، `createRoomDiagnostics`                                      | aggregateهای status                                 | list/detail metadata جدید؛ close امن و receipt جدید فاز ۲                                          |
| Match و پذیرش      | [index](../../apps/api/src/matches/index.ts)، diagnostics و processing                                   | lock/version/idempotency، pins، lifecycle داخلی     | list/detail projection جدید فاز ۱؛ wrapper termination با Admin context/audit فاز ۲                |
| Matchmaking        | queue Redis، admission/reservation پایدارِ Matches                                                       | diagnostics پذیرش از port Matches                   | نمایش bounded؛ query مستقیم Redis یا جدول ماژول دیگر در Admin ممنوع                                |
| Reconnect/Presence | lease/epoch و bot takeover موجود                                                                         | مشاهدهٔ counters مجاز                               | Admin عضو/بازیکن ساختگی نمی‌شود؛ مشاهدهٔ metadata فقط                                              |
| Chat               | membership-based Chat و content-free outbox                                                              | references و policy داده                            | محتوای chat در پنل مجاز نیست؛ evidence فقط پس از OD-005/ADR مستقل، فاز ۳                           |
| آمار               | [Leaderboard index](../../apps/api/src/leaderboard/index.ts)، resultها و `stats_*` نسل‌دار               | projection/result truth و rebuild worker            | port فعلی own/board بازیکن است؛ impersonation مدیر ممنوع؛ admin aggregate port جدید؛ rebuild فاز ۳ |
| PostgreSQL         | [schema](../../packages/database/prisma/schema.prisma)، [scope](../../packages/database/src/database.ts) | منبع durable و transaction patterns                 | Admin در ownership map و schema وجود ندارد؛ migration آینده فقط در فاز مربوط                       |
| DB credentials     | [permissions.sql](../../packages/database/prisma/permissions.sql)                                        | least privilege API/Worker و migration owner        | credential/scope audit و bootstrap/recovery آینده؛ blanket grant داده نشود                         |
| Redis/BullMQ       | limiter، outbox dispatch، retries و receipts                                                             | هماهنگی و تحویل at-least-once                       | namespace/ACL/budget Admin؛ Redis منبع root/session/audit نیست                                     |
| Monitoring         | [metrics خصوصی](../architecture/operational-observability.md) و diagnostics ownerها                      | snapshot allowlisted و safe errors                  | facade/overview جدید؛ loopback endpoint به browser proxy نشود                                      |
| Telemetry          | `packages/observability`، Pino allowlist، safe reporting                                                 | correlation و fixed event labels                    | audit، schema و دسترسی مستقل دارد؛ افزودن field به لاگ خودکار مجاز نیست                            |
| Bot/Support        | `bot_support_submissions` و ADR-074                                                                      | adapter پشتیبانی/Telegram آینده                     | نه IdP و نه Admin Bot؛ lifecycle مدیر از Bot فعلی مجاز نمی‌شود                                     |
| استقرار            | [nginx](../../infra/docker/server/nginx.conf)، [Compose](../../infra/docker/server/compose.yaml)         | host ingress، شبکهٔ private، TLS و scan/containment | hostname/listener Admin موجود نیست؛ مسیر admin در public hosts بسته است؛ هیچ تغییر این فاز         |
| CI و قرارداد       | manifest/Turbo، ESLint architecture، baselineها                                                          | ابزارهای موجود و قرارداد additive                   | suite/test script/baseline Admin وجود ندارند؛ فاز ۱ در source/CI اضافه می‌شوند                     |

diagnostics فعلی count query دارند؛ استفادهٔ مجدد به معنی اجرای همهٔ آن‌ها با هر refresh مرورگر نیست. collection coalesced، سقف فرکانس، validity و بودجهٔ query لازم است. schema/descriptor عمومی catalog هنوز همهٔ مسیرهای کهربا را یکسان پوشش نمی‌دهد؛ readiness نصب‌شده و قابلیت انتشار عمومی یکی نیستند.

## ۴. معماری تثبیت‌شده و قواعدی که تصمیم باز نیستند

| شناسه  | تصمیم مرجع                                         | پیامد اجرایی آینده                                                                           |
| ------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| P0-A01 | ADR-078: frontend مستقل و backend modular monolith | apps/admin و listener خصوصی؛ سرویس دامنه/DB جدید پیش‌فرض نیست                                |
| P0-A02 | ADR-039: auth/MFA/private access/audit مستقل       | player/Bot credentials هیچ authority مدیریتی ندارند                                          |
| P0-A03 | ADR-079: OWNER binding محافظت‌شده                  | all registered capabilities؛ root خارج از role CRUD؛ سایر مدیران deny-by-default             |
| P0-A04 | ADR-079: نقش + override فردی و scope               | permissionهای view/create/edit/manage/approve مستقل؛ DENY فردی منطبق برای غیرمالک غالب       |
| P0-A05 | ADR-079: primary-current authorization             | gate جدید بعد commit حق stale grant ندارد؛ اتصال فعال ≤۵s؛ اثر قبلاً admitted عقبگرد نمی‌کند |
| P0-A06 | ADR-079: OWNER_FINAL                               | یک مالک با fresh reauth/reason/audit می‌تواند تصمیم نهایی معتبر بگیرد؛ نفر دوم شرط مالک نیست |
| P0-A07 | ADR-039/023/024                                    | admission audit پیش از اثر؛ owner transaction + receipt/outbox؛ outcome reconciliation       |
| P0-A08 | ADR-078/079                                        | owner دامنه با OWNER انسانی متفاوت؛ hidden state/result/audit با root bypass نمی‌شوند        |
| P0-A09 | درخواست جاری و ADR-080                             | اجرای یک فاز، گزارش، توقف؛ deployment مجوز جدا می‌خواهد                                      |

profile زمانی ADR-079 حفظ می‌شود: challenge مالک ۱۲۰s، احراز هویت واقعاً پس از challenge و حداکثر ۶۰s پیش از تصمیم، execution grant یک‌بارمصرف ۶۰s، emergency ≤۱۰min. این‌ها **هدف طراحی** هستند؛ هیچ آزمون یا تنظیم واقعی IdP/clock/DB در این فاز آن‌ها را تأیید نکرده است.

## ۵. تصمیم‌های محیطی و gateها

وضعیت‌ها: `FIXED` از ADR/دستور صریح؛ `OPEN` نیازمند انتخاب مالک یا دادهٔ واقعی؛ `DEFERRED` عمداً برای فاز مصرف‌کننده نگه داشته شده؛ هیچ گزینهٔ پیشنهادی به معنی تصویب نیست.

| ID     | موضوع / وضعیت                                 | تصمیم یا گزینهٔ قابل بررسی                                                                     | شاهد لازم / مسئول و gate                                                                                       |
| ------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| P0-D01 | IdP — OPEN طبق پاسخ مالک                      | OIDC موجودِ واجد شرایط؛ در نبود آن provider managed واجد شرایط یا self-hosted با توجیه عملیاتی | مالک/امنیت: provider، issuer، assurance mapping و qualification؛ پیش از integration/پذیرش فاز ۱                |
| P0-D02 | private access — OPEN طبق پاسخ مالک           | VPN خصوصی تا ingress یا identity-aware access proxy با origin بسته؛ IP allowlist کنترل مکمل    | مالک زیرساخت: روش، peer inventory، بستن دسترسی مستقیم و topology؛ پیش از listener واقعی فاز ۱                  |
| P0-D03 | session عادی — OPEN                           | absolute/idle، MFA baseline، key rotation و bounded verification policy صریح                   | مالک/امنیت: مقادیر عددی، tradeoff و آزمون expiry؛ پیش از session runtime فاز ۱                                 |
| P0-D04 | هویت مالک — OPEN                              | realm و issuer/subject از ceremony خصوصی؛ بدون انتشار شناسه در repo                            | مالک: reference امن و custody bootstrap، proof و دو authenticator مستقل؛ پیش از enrollment واقعی               |
| P0-D05 | storage/session format — FIXED design         | signed host-only HttpOnly/Secure cookie مستقل + metadata durable؛ no refresh MVP               | مهندسی: profile cryptographic/CSRF/expiry سازگار با IdP در فاز ۱؛ credential خام ذخیره نشود                    |
| P0-D06 | retention امنیت Admin — OPEN                  | policy جدا برای audit، session tombstone/receipt، invitation و recovery references             | مالک حریم خصوصی/عملیات: مدت، دسترسی، retention identity و backup overlap؛ پیش از دادهٔ انسانی واقعی            |
| P0-D07 | recovery — OPEN integration                   | کلید پشتیبان مستقل، provider recovery بررسی‌شده؛ emergency از پیش enrolled و محدود             | مالک/امنیت: custody و proofهای مستقل، drill؛ normal recovery پیش از enrollment، emergency پیش از فعال‌سازی خود |
| P0-D08 | hostname/realm staging — OPEN                 | admin.hambazi.top هدف محصول؛ test/staging origin/issuer/key مستقل و نام آن نیازمند تصمیم       | مالک زیرساخت: inventory origin/TLS/cookie؛ پیش از هر deployment جداگانه                                        |
| P0-D09 | poll/pool/query budgets — OPEN                | تعداد مدیر، dataset، refresh، statement/lock timeout و pool مجزا بر مبنای اندازه‌گیری          | مهندسی/مالک: workload profile و threshold؛ پیش از فعال‌سازی readهای واقعی؛ بدون CCU حدسی                       |
| P0-D10 | roles/assignments — FIXED model، OPEN افراد   | OWNER و templateهای صریح ADR-079؛ invitation و grants واقعی هنوز تعیین نشده                    | فقط مالک؛ تعیین افراد قبل invite، نه prerequisite تحلیل فاز صفر                                                |
| P0-D11 | invite TTL و delivery — DEFERRED فاز ۲        | identity-bound، one-time accept؛ provider provision خودکار فرض نشود                            | مالک: expiry عددی و channel قبل فعال‌سازی دعوت؛ هیچ ارسال این فاز                                              |
| P0-D12 | اعلان تصمیم/incident — OPEN channel           | metadata امن، مقصد ثابت، outbox، failure visible؛ بدون متن محرمانه                             | مالک عملیات: receiver/reference امن و retention؛ قبل مصارف OWNER_FINAL واقعی                                   |
| P0-D13 | evidence/ban/chat — DEFERRED فاز ۳            | OD-005 و استثنای محدود ADR-039؛ projection content-aware مستقل                                 | مالک محصول/حریم خصوصی؛ تا تصمیم، متن/تنبیه محتوایی بسته                                                        |
| P0-D14 | backup/PITR/RPO/RTO — OPEN محیط               | audit/root metadata نیز در recovery plan باشند؛ epoch/restore replay بررسی شود                 | مالک زیرساخت؛ قبل دادهٔ پایدار واقعی و پذیرش عملیاتی فاز ۴                                                     |
| P0-D15 | isolation سخت process — DEFERRED/ریسک ثبت‌شده | MVP دو listener در یک process؛ threat review ریسک credential مشترک را آشکار می‌کند             | مالک امنیت/عملیات؛ ارزیابی قبل production؛ جداسازی اگر evidence لازم کند                                       |

انتخاب‌های D01/D02 در این نوبت نهایی نمی‌شوند. D03/D06/D09 با عدد ساختگی بسته نمی‌شوند. برای کار محلی آینده می‌توان fixtureهای مصنوعی و dependency-injected داشت، اما fixtureها نقش config محیط یا حساب مالک واقعی را ندارند. هیچ «ادامه بده» کلی در آینده نباید خودکار همهٔ OPENها را تصویب‌شده تلقی کند؛ پاسخ باید به تصمیم/مقدار مشخص قابل اتصال باشد.

### معیار انتخاب IdP

اولویت بررسی: اگر سرویس موجود همهٔ کنترل‌ها را دارد، reuse آن؛ در غیر این صورت مقایسهٔ managed با هزینه/دسترس‌پذیری قابل قبول و self-hosted با مالکیت patch/backup/uptime روشن. این جدول نام محصول، خرید یا سرویس خارجی ایجاد نمی‌کند.

| معیار اجباری                              | روش qualification آینده                                                   | رد شدن                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Authorization Code + PKCE و redirect دقیق | مثبت/منفی state/nonce/PKCE، callback replay و issuer/audience             | wildcard redirect، implicit flow یا trust به issuer کاربر                   |
| phishing-resistant MFA و assurance معتبر  | key با user verification؛ mapping واقعی acr/amr و auth_time               | SMS/TOTP تنها به‌جای profile انتخاب‌شده، یا `mfa=true` غیرقابل راستی‌آزمایی |
| forced reauthentication واقعی             | session گرم IdP؛ challenge تازه؛ اثبات auth_time و تعامل تازه             | redirect بدون احراز هویت تازه با ادعای step-up                              |
| subject پایدار و enrollment بسته          | اتصال issuer/subject، email change، revoke و recovery                     | email یا role claim به‌عنوان root authority                                 |
| key source قابل اعتماد و rotation         | keyset config محدود، الگوریتم allowlist، overlap/revocation               | URL کلید دلخواه، الگوریتم client یا token ناهم‌audience                     |
| recovery و key custody                    | backup authenticator مستقل، از دست‌رفتن کلید و audit provider             | reset توسط مدیر عادی، recovery ضعیف یا bypass MFA                           |
| دسترس‌پذیری واقعی                         | مسیر مرورگر مدیر و egress backend به token/JWKS/time source در محیط منتخب | صرف بازشدن صفحهٔ login بدون تبادل موفق backend                              |
| عملیات و داده                             | patch owner، هزینه، privacy/retention، config export و خروج از provider   | انتخاب بدون مسئول عملیاتی یا evidence قابلیت‌ها                             |

مبنای معیارها: [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html) برای validation هویت و freshness، [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) برای امنیت OAuth/PKCE، [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html) برای assurance و authenticators. عددهای profile و استثنای quorum مالک از ADR-079 می‌آیند؛ الزام عددی نقل‌شده از این استانداردها نیستند.

### معیار انتخاب private access

| گزینه                                       | فایده                                  | تعهد و معیار رد                                                                             |
| ------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| VPN/private network تا ingress              | origin غیرعمومی و peer inventory محدود | lifecycle کلید/دستگاه و مسیر موبایل/دسکتاپ؛ subnet گسترده یا دسترسی مستقیم بدون app auth رد |
| identity-aware proxy با upstream خصوصی/mTLS | کنترل ورود و device/session در لبه     | issuer/audience/peer verification و origin bypass test؛ header خام یا upstream باز رد       |
| IP allowlist                                | لایهٔ مکمل ساده برای peer ثابت         | به‌تنهایی هویت انسانی/MFA نیست و برای IP پویا کافی نیست                                     |

Cloudflare Worker موجودِ Telegram، قابلیت Admin Access اثبات‌شده ندارد؛ از وجود Cloudflare در پروژه، حساب یا policy Access نتیجه نمی‌شود. اجرای VPN/proxy جدید، تغییر route/DNS و گشودن hostname همگی خارج از فاز صفرند.

## ۶. KPIهای قابل‌نمایش و منبع معتبر

| KPI                       | تعریف و owner                                  | وضعیت / محدودیت                                                              |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Match فعال                | count وضعیت ACTIVE در Matches                  | diagnostics موجود؛ lifecycleهای دیگر جدا؛ نه «تعداد بازی امروز»              |
| اتاق منتظر/پر/شروع‌شده    | count هر status در Rooms                       | موجود؛ فهرست metadata و filter port جدید می‌خواهد                            |
| صف پذیرش                  | SEARCHING/RESERVED منقضی‌نشده و سن قدیمی‌ترین  | port Matches؛ count Redis raw معادل حقیقت durable نیست                       |
| outbox lag                | pending/failed و سن قدیمی‌ترین pending         | existing diagnostics؛ PUBLISHED موفقیت consumer نیست                         |
| قطع/بازگشت/Bot takeover   | count رخدادهای ثبت‌شده و seat statusهای مربوط  | retained data، cumulative/range روشن؛ شاخص منحصربه‌فرد کاربران نیست          |
| pool pressure             | total/idle/waiting/max هر process              | موجود و node-local؛ جمع poolها برای sizing جدا                               |
| latency/errors            | histogram و errorهای ثابت هر service/operation | metrics اختیاری و private؛ بازه/instance/source و freshness لازم             |
| نتایج تکمیل/برد           | immutable result و projection نسل active       | port aggregate Admin جدید؛ TERMINATED آمار تکمیل/برد نمی‌دهد؛ v1/v2 retained |
| کاربران ثبت‌شده/فعال حساب | aggregate در Users با تعریف status و تاریخ     | port جدید؛ وضعیت حساب، DAU یا CCU نیست                                       |
| session/operatorهای Admin | metadata خود Admin                             | هنوز پیاده نشده؛ credential نمایش داده نمی‌شود                               |
| CCU سراسری یکتا           | نیازمند تعریف presence و dedupe چند node       | فعلاً unavailable؛ جمع connected_users چنین عددی نیست                        |
| DAU/retention/revenue     | نیازمند event/definition مالک محصول            | خارج از KPI اولیه؛ placeholder به‌جای واقعیت نمایش داده نشود                 |

هر KPI `asOf`، validity، source، environment، بازه در صورت applicable و علت unavailable دارد؛ unknown با صفر جایگزین نمی‌شود. summary بین ownerها snapshot سراسری اتمیک نیست. واحد/دقت latency مشخص، countهای بزرگ decimal string، تاریخ API UTC و نمایش Asia/Tehran است. تقویم UI، دورهٔ Monday UTC آمار فعلی را تغییر نمی‌دهد. هدف‌های ADR-045/046 باقی‌اند و استثناهای ADR-048 ادعای ظرفیت production نیستند.

## ۷. تحویل‌های قراردادی و بررسی امنیت

- [قرارداد مفهومی و mapping capability/owner/phase](../contracts/admin-phase-0.md): مرز DTO، فهرست readهای فاز یک، mutationهای آینده، error/event/idempotency و dependency enforcement.
- [مدل تهدید Admin](../security/admin-threat-model.md): دارایی، trust boundary، مسیرهای سوءاستفاده، کنترل و آزمون نگاشت‌شده به ACها؛ رفتار هنگام outage و ریسک‌های باقیمانده.
- [ADR-080](../adr/080-admin-phase-gates-and-phase-zero-baseline.md): ترتیب authoritative فازها، توقف اجباری، فرق مرز مستندی با gate محیطی و audit پایهٔ bootstrap/auth.
- [ADR-079 و ACها](../architecture/admin-access-control.md): specification root/RBAC/approval بدون ساخت حساب یا grant واقعی حفظ شده است.

**نکتهٔ وابستگی audit:** «پنل مشاهده در فاز ۱» یعنی mutation محصول ندارد؛ bootstrap، login/logout و revoke session خود عملیات امنیتی‌اند. audit حداقلی immutable و receipt لازم برای این مسیرها باید در همان فاز ۱ ساخته/تست شوند. فاز ۲ آن را به approval، عملیات بین ownerها و reconciliation کامل توسعه می‌دهد؛ ایجاد حساب واقعی پیش از audit پایه مجاز نیست. این ترتیب معماری را تضعیف نمی‌کند و از ورود زودهنگام به mutation محصول جلوگیری می‌کند.

## ۸. برنامهٔ تست و شواهد همین فاز

فاز صفر runtime جدید ندارد؛ آزمون‌های اجرایی auth/MFA/DB/Redis/E2E در این فاز قابل ادعا نیستند. بررسی‌های همین فاز:

| بررسی                                     | نتیجه / شاهد                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| source/manifest و export inventory        | انجام شد؛ تفاوت port موجود و port پیشنهادی در بخش ۳ و قرارداد ثبت شد                             |
| بررسی نقش/امنیت                           | threat review مستندی انجام شد؛ threatها به ACها و فاز مصرف‌کننده متصل‌اند؛ penetration test نیست |
| لینک‌ها، جدول‌ها، code fence و whitespace | کنترل محلی روی فایل‌های همین فاز؛ نتیجهٔ نهایی در closeout پایین                                 |
| formatting                                | formatter موجود از manifest، محدود به Markdownهای تغییرکرده؛ نتیجه در closeout                   |
| `pnpm check:architecture`                 | gate واقعی موجود، بدون تغییر policy/source؛ نتیجه در closeout                                    |
| unit/integration/build/E2E/load           | اجرا نمی‌شوند: محصول/contract اجرایی تغییر نکرده؛ DB/Redis/محیط واقعی راه‌اندازی نمی‌شود         |

برای فازهای بعد، مطابق scope واقعی و scriptهای موجود: tooling tests برای workspace/boundary، API/config/contract و schema، integration disposable PostgreSQL/Redis، سپس browser/E2E و fault/load. امروز script اختصاصی Admin، baseline و export اجرایی‌اش وجود ندارد؛ هیچ command فرضی برای آن معرفی نمی‌شود. root `pnpm check` build/testهای زیادی دارد و برای تغییر صرفاً مستندی این فاز جایگزین بررسی متناسب نیست.

## ۹. معیار خروج و آمادگی فاز بعد

| معیار                                         | وضعیت                                                      |
| --------------------------------------------- | ---------------------------------------------------------- |
| inventory و owner map با شاهد source          | تکمیل                                                      |
| نقش OWNER و مجوزها با مرجع واحد               | تکمیل مستندی؛ اجرای امنیتی هنوز وجود ندارد                 |
| threat model، scope داده و failure behavior   | تکمیل مستندی؛ تست runtime در فاز مربوط                     |
| قرارداد مفهومی و KPI بدون ادعای قابلیت موجود  | تکمیل                                                      |
| تفکیک تصمیم ثابت، گزینهٔ پیشنهادی و تصمیم باز | تکمیل؛ D01/D02 طبق پاسخ مالک باز                           |
| انتخاب IdP/private access و policyهای محیطی   | باز؛ نیازمند پاسخ مشخص، صرف اجازهٔ ادامه تصویب مقادیر نیست |
| مجوز ورود به فاز ۱                            | صادر نشده؛ توقف اجباری بعد گزارش فاز صفر                   |
| مجوز staging/production                       | صادر نشده                                                  |

**نتیجه:** تحویل قابل انجامِ فاز صفر آماده است. پذیرش کامل gate اجرایی فاز یک نیازمند بستن تصمیم‌های محیطی مرتبط و تأیید صریح همان فاز است. هیچ فاز بعدی در این نوبت شروع نمی‌شود. تعیین D11/D13 که مصرفشان در فازهای بعد است، با تأخیر مجاز و gate مشخص ثبت شده و نباید جلوی آزمون مصنوعی مرحلهٔ زودتر را بی‌دلیل بگیرد.

## ۱۰. Closeout بررسی محلی

نتایج واقعی همین نوبت:

- `pnpm check:architecture` با exit code صفر: **۱۵ workspace و ۳۰۱ فایل source** پذیرفته شدند. این شاهد سلامت boundaryهای فعلی است؛ boundaryهای Admin هنوز پیاده نشده‌اند.
- `pnpm exec prettier --check` روی هشت Markdown تغییرکرده، در اجرای اولیه هفت فایل نیازمند formatting یافت؛ formatter موجود فقط روی همان فایل‌های این فاز اجرا شد و بررسی نهایی مجدداً انجام شد. از script سراسری `format` که کل مخزن را می‌نویسد استفاده نشد.
- کنترل ساختاری محلی روی **۸ فایل، ۱۶۵ لینک محلی، ۲۰ threat ID یکتا و ۱۵ decision ID یکتا** موفق بود؛ code fence و whitespace معتبرند.
- hash سه سندی که در این فاز نباید تغییر می‌کردند، با شروع نوبت برابر ماند: ADR-039، ADR-079 و `admin-security-design.md`. تغییرهای قبلی کاربر حذف یا commit نشدند.
- `git diff --check` موفق بود؛ فهرست تغییرهای tracked/untracked همگی Markdown زیر `docs` هستند. هیچ source/manifest/lockfile/infra runtime تغییر نکرد.
- نصب، build، unit/integration/E2E/load یا probe محیط واقعی اجرا نشدند؛ این فاز هیچ کد یا قرارداد اجرایی اضافه نمی‌کند و مجوز اجرای محیط ندارد. threat review، آزمون نفوذ اجراشده نیست.

فایل‌های ایجادشدهٔ این فاز: همین گزارش، `admin-threat-model.md`، `admin-phase-0.md` و ADR-080. فایل‌های قبلی اصلاح‌شدهٔ این فاز: معماری Admin، سند access، ADR-078 و implementation plan. تفاوت raw Git status با این لیست به شش سندی مربوط است که پیش از شروع فاز در worktree بودند.

پس از این گزارش، کار در فاز صفر متوقف است. انتخاب‌های محیطی D01…D15 با وضعیت مشخص ثبت شده‌اند؛ هیچ‌کدام صرفاً به دلیل آماده‌بودن این گزارش تصویب‌شده محسوب نمی‌شوند.

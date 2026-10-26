# آمادگی راه‌اندازی نخستین OWNER در Staging — ۲۶ اکتبر ۲۰۲۶

## نتیجهٔ فعلی: ایجاد حساب مجاز و آماده نیست

این بازبینی فقط ادامهٔ امنیت هویت فاز یک است. فاز دو، ساخت مدیران، تغییر سرور و ایجاد حساب واقعی یا آزمایشی اجرا نشده‌اند. تنها تغییر این نوبت مستندات محلی است. مالک اعلام کرده هنوز دو کلید مستقل Ed25519 ندارد و قصد دارد با اطلاعات اولیه وارد شود و سپس Password و PIN را تغییر دهد.

**موانع قطعی:** کلیدها و اثبات مستقل مالکیت آماده نیستند؛ CLI فعلی به فایل حاوی اطلاعات خام وابسته است؛ تغییر Password و خروج همهٔ نشست‌ها پس از آن وجود ندارد؛ backup/restore و custody لازم برای هویت واقعی اثبات نشده‌اند. در نتیجه هیچ اطلاعات ورود واقعی نباید در چت درخواست یا دریافت شود و فرمان ایجاد حساب ارائه نمی‌شود.

«حساب موقت OWNER» در این طرح یعنی **همان یک OWNER حفاظت‌شدهٔ Staging با اطلاعات اولیهٔ قابل تعویض**؛ به معنی مالک دوم، root قابل‌حذف، رمز پیش‌فرض یا معافیت از proof نیست. اطلاعات این محیط نباید در Production استفاده شوند.

مراجع: [گزارش انتشار](admin-private-deployment-2026-10-26.md)، [گزارش فاز یک](admin-dashboard-phase-1.md)، ADRهای [039](../adr/039-administrative-security-design.md)، [078](../adr/078-admin-dashboard-architecture.md)، [079](../adr/079-owner-and-admin-access-control.md)، [080](../adr/080-admin-phase-gates-and-phase-zero-baseline.md)، [081](../adr/081-admin-local-password-and-owner-pin.md) و [082](../adr/082-admin-private-ssh-deployment.md).

## بررسی خواندنی محیط و حدود شواهد

بررسی سرور در `2026-10-26T06:07:30Z`، برابر **۰۹:۳۷:۳۰ تهران** انجام شد:

- کانتینر Admin سالم و فعال، بدون published port؛ image ID مطابق رسید انتشار است.
- تعداد OWNER، operator و session هر سه صفر است. رویداد موفق Bootstrap یا Recovery وجود ندارد؛ ۱۶ migration موفق ثبت شده‌اند.
- role زمان اجرای Admin حق DELETE روی Audit ندارد.
- فایل‌های `runtime.env` و `operator-database.env` با مالک root و mode `0600` موجودند. موجودبودن فایل credential به معنی اثبات custody، backup یا صحت اجرای ابزار خصوصی نیست.
- در inventory مسیر خصوصی Admin، فایل یا بستهٔ مستقلی برای اعتماد به کلیدهای operator/ownership مشاهده نشد؛ این مشاهده ادعای جست‌وجوی تمام دیسک یا وجودنداشتن کلید در دستگاه مالک نیست. خود مالک نیز نداشتن دو کلید را تأیید کرده است.
- backup قبل از migration موجود است؛ گزارش انتشار فقط بررسی catalog را اثبات می‌کند، نه restore کامل. در پوشهٔ رسید انتشار، شواهد restore کامل مشاهده نشد.
- شواهد امنیت Admin و Core در زمان بررسی منقضی نبودند؛ deadline ثبت‌شده **۲۶ اکتبر ۲۲:۴۰:۳۵ تهران** بود. این نتیجه snapshot است؛ پیش از هر اجرای آینده باید deadline و containment دوباره خواندنی بررسی شوند.

هیچ Bootstrap/Recovery، تولید کلید، backup جدید، restore، renewal، restart یا اصلاح پیکربندی روی سرور اجرا نشد. برای بررسی از controllerهایی که ممکن است هنگام خطا فایل وضعیت بنویسند استفاده نشد؛ query دیتابیس در تراکنش READ ONLY و با timeout اجرا شد. SSH/DB ممکن است access telemetry معمول خود را ثبت کنند؛ هیچ اطلاعات ورود انسانی وارد این مسیر نشد.

## ابزار موجود دقیقاً چه چیزهایی را پوشش می‌دهد؟

| موضوع                              | وضعیت واقعی                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Argon2id                           | Password و PIN verifier مستقل با salt تصادفی؛ PIN پیش از Argon2id با pepper/HMAC مستقل خارج DB محافظت می‌شود                                                    |
| Bootstrap                          | singleton و binding حفاظت‌شده، دو امضای مستقل، role مخصوص، receipt و Audit در تراکنش واحد                                                                       |
| Recovery                           | فقط PIN همان OWNER را جایگزین و lock را رفع می‌کند؛ identity و Password را تغییر نمی‌دهد؛ epochها را افزایش و نشست‌های قبلی را نامعتبر می‌کند                   |
| تغییر PIN توسط OWNER               | UI و `POST /v1/admin/auth/pin/change` وجود دارند؛ Password و PIN فعلی لازم‌اند؛ همهٔ نشست‌های FULL/PENDING با epoch جدید نامعتبر می‌شوند و ورود دوباره لازم است |
| تغییر Password توسط OWNER          | **وجود ندارد**؛ route، UI، use case، grant محدود برای تغییر verifier و رویداد PASSWORD_CHANGED پیاده نشده‌اند                                                   |
| تعویض اجباری اطلاعات در اولین ورود | flag یا حالت محدودِ credential موقت در نسخهٔ فعلی وجود ندارد؛ نمی‌توان چنین رفتاری را وعده داد                                                                  |
| ورود تعاملی خصوصی                  | **آماده نیست**؛ `admin-provision.ts` فقط `ADMIN_CEREMONY_REQUEST_FILE` و `ADMIN_CEREMONY_PROOF_FILE` را می‌خواند                                                |
| ثبت رد Bootstrap/Recovery          | catch ابزار فقط `ADMIN_CEREMONY_DENIED` چاپ می‌کند؛ ثبت پایدار و قابل‌هم‌بستگیِ همهٔ ردهای ابزار/خطاهای قبل DB احراز نشده است                                   |

کدهای مرجع: `apps/api/src/composition/admin-provision.ts`، `apps/api/src/admin/application/provisioning.ts`، `application/service.ts`، `infrastructure/provisioning-authority.ts`، `infrastructure/repositories/admin.ts`، `infrastructure/http.ts` و `packages/database/prisma/admin-permissions.sql`.

دو امضا در برنامه اعتبارسنجی می‌شوند، نه داخل PostgreSQL. dump یا credential عادی runtime برای بازیابی کافی نیست؛ اما credential اختصاصی recovery خودش اختیار تغییر ستون‌های PIN/lock را دارد و باید خارج runtime و در custody اپراتور حفاظت شود. DBA/superuser یا root مخرب سرور مرز اعتماد بیرونی‌اند؛ دو امضا و trigger ادعای مهار آن‌ها نیستند.

### تست‌های قبلی در برابر آمادگی واقعی

گزارش فاز یک ۱۴ تست اختصاصی Admin و ۱۱ integration موفق با PostgreSQL/Redis واقعیِ disposable را ثبت کرده است. بررسی source نشان می‌دهد تست‌ها به application port وصل می‌شوند؛ آزمون موفق آن‌ها اثبات اجرای end-to-end خود CLI، TTY، امضاکنندهٔ انسانی یا recovery روی سرور مستقر نیست.

پوشش موجود شامل password غلط بدون افزایش شمارنده، PENDING بدون اختیار، PIN اشتباه سوم و قفل پایدار، retry یک intent بدون دوباره‌شماری، رقابت درخواست‌ها، restart واقعی PostgreSQL، رد recovery بی‌proof، دو امضای مستقل/هدف و انقضای proof، ابطال نشست‌ها و rollback در شکست Audit است. شکست Audit تست‌شده را نباید بدون تست جدا به تمام مراحل Bootstrap/Recovery تعمیم داد.

این نوبت تست‌هایی که account، credential یا signing key مصنوعی تولید می‌کنند دوباره اجرا نشدند؛ مطابق درخواست مالک هیچ credential آزمایشی تازه ساخته نشد. اعداد بالا شواهد ثبت‌شدهٔ پیشین‌اند، نه اجرای جدید.

## پیش‌نیازهای لازم پیش از ساخت حساب

| شناسه | پیش‌نیاز                  | معیار بستن                                                                                                                                   | وضعیت                                   |
| ----- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| O-01  | تعیین هدف و اختیار        | فقط همین Staging/realm، همان OWNER یکتا، اطلاع از تفاوت دادهٔ واقعی هویت با دادهٔ بازی disposable                                            | تأیید محدوده موجود؛ تصمیم نگه‌داری باز  |
| O-02  | دو مرجع امضای مستقل       | کلید Ed25519 مجزا، custody جدا، fingerprint مورد تأیید مالک و اپراتور، public trust anchor خارج DB/runtime                                   | ناقص؛ مالک کلید ندارد                   |
| O-03  | ورودی انسانی بدون فایل    | ابزار TTY/کانال خصوصی آزموده، no-echo، بدون raw credential در argv/env/stdout/log/temp؛ لغو امن                                              | پیاده نشده                              |
| O-04  | تغییر Password و PIN      | self-service مالک با احراز مجدد، Hash مستقل، ثبت Audit و ابطال durable تمام نشست‌ها؛ تست درخواست هم‌زمان/قدیمی                               | PIN موجود؛ Password ناقص                |
| O-05  | backup/restore و کلیدها   | snapshot سازگار با schema فعلی، backup رمزگذاری‌شدهٔ config/pepper/key version، restore جدا و reconciliation، دسترسی مالک به custody         | اثبات نشده                              |
| O-06  | recovery عملیاتی          | اجرای کل مسیر ابزارِ بازبینی‌شده با دو مرجع مستقل در مقصد disposable مجاز؛ قفل سوم، restart، revoke و Audit؛ بدون آزمایش قفل روی OWNER واقعی | فقط application integration قبلی        |
| O-07  | Audit پایهٔ ceremony      | موفقیت اتمیک؛ رد/لغو/خطای ابزار و نتیجهٔ نامعلوم دارای metadata پایدار و بدون credential؛ ناظر و مسیر بررسی مشخص                             | پایهٔ موفقیت موجود؛ مسیر عملیاتی ناقص   |
| O-08  | ایمنی ورودی در OS/ترمینال | نبود session recording یا input logging روی مسیر انتخابی، core dump غیرفعال و swap ایمن برای process حامل secret، مدیریت abort/disconnect    | بررسی/تأیید نشده                        |
| O-09  | وضعیت تازهٔ استقرار       | TLS و SSH host key معتبر، شبکه خصوصی، health، artifact دقیق، زمان صحیح و deadline معتبر برای کل ceremony                                     | در snapshot سالم؛ باید دوباره بررسی شود |
| O-10  | تأیید نهایی مالک          | پس از ارائهٔ نتایج O-01…09، اجازهٔ مشخص برای نصب ابزارِ آماده و سپس **ایجاد همان OWNER**                                                     | صادر نشده                               |

صلاحیت عمومی فاز دو، ساخت Super Admin، external IdP/MFA، ربات، مالی و approvals محصول پیش‌نیاز این کار نیستند و شروع نمی‌شوند. تست بار launch و برنامهٔ کامل عملیات بلندمدت نیز با یک OWNER خصوصی معادل نیست؛ حداقل pool/KDF/disk budget و پاسخ‌گویی انسانی لازم است، ولی peak/SLO عمومی نباید حدس زده یا پذیرفته‌شده اعلام شود.

### مرز نگه‌داری و استثنای Staging

[ADR-050](../adr/050-disposable-personal-staging-exception.md) محیط شخصی را disposable می‌داند و در بند ۶ می‌گوید: “The exception expires when the environment gains non-disposable data”. هویت و کلید بازیابی واقعی OWNER را نمی‌توان بی‌صدا همان دادهٔ دورریختنی فرض کرد. snapshot محدودِ انتشار ADR-082 هم جای برنامهٔ بازیابی یک هویت واقعی را نمی‌گیرد.

قبل از enrollment، مالک باید دامنهٔ نگه‌داری هویت Admin و پایان/اصلاح محدود این استثنا را مشخص کند: چه چیزی backup می‌شود، کجا و با کدام custody، چه کسی restore را می‌پذیرد و RPO/RTO قابل‌قبول چیست. در این نوبت هیچ سرویس backup/PITR یا زمان‌بندی جدیدی ساخته نمی‌شود و سیاست بازی/Production تغییر نمی‌کند. تعداد روزهای retention یا اعداد RPO/RTO از طرف عامل انتخاب نشده‌اند.

## مسیر امن تهیهٔ کلیدها — دستورالعمل آینده، اجرا نشده

این دو کلید برای Bootstrap/Recovery هستند و وابستگی ورود عادی به سرویس هویت خارجی ایجاد نمی‌کنند. داشتن یک SSH key یا دو فایل تازه به‌تنهایی اثبات مالکیت پروژه نیست: public key مالک باید با تأیید انسانی/مرجع مستقل شناخته‌شده به مالک HamBazi نسبت داده شود، نه با اعتماد به هر کلیدی که همان سرور ارائه کند.

۱. مالک دو محل نگه‌داری مستقل انتخاب کند: یک دستگاه یا رسانهٔ رمزگذاری‌شدهٔ متعلق به مالک برای ownership key و محیط مدیریتی/رسانهٔ دیگری برای operator key. همان انسان می‌تواند هر دو اختیار را داشته باشد؛ دو کلید در یک پوشه با یک custody کافی نیست. کلید خصوصی ownership روی VPS، دیتابیس، runtime، Git یا گفت‌وگو منتقل نشود. نسخهٔ پشتیبان هر کلید هم مستقل و رمزگذاری‌شده باشد.

۲. هر جفت فقط در ترمینال شخصی همان custody تولید شود. OpenSSL محلی 3.5.5 بررسی شد؛ فرمان‌ها **در این نوبت اجرا نشده‌اند**. مسیرهای زیر placeholder هستند و پیش از اجرای انسانی باید با مسیر خصوصی مطلق همان رسانه جایگزین شوند؛ هیچ مقدار secret در command نوشته نمی‌شود:

```sh
umask 077
openssl genpkey -algorithm ED25519 -aes-256-cbc \
  -out /ABSOLUTE-PRIVATE-OWNER-VAULT/hambazi-ownership-private.pem
openssl pkey \
  -in /ABSOLUTE-PRIVATE-OWNER-VAULT/hambazi-ownership-private.pem \
  -pubout -out /ABSOLUTE-PRIVATE-OWNER-VAULT/hambazi-ownership-public.pem
```

در custody اپراتور و ترمینال جدا:

```sh
umask 077
openssl genpkey -algorithm ED25519 -aes-256-cbc \
  -out /ABSOLUTE-PRIVATE-OPERATOR-VAULT/hambazi-operator-private.pem
openssl pkey \
  -in /ABSOLUTE-PRIVATE-OPERATOR-VAULT/hambazi-operator-private.pem \
  -pubout -out /ABSOLUTE-PRIVATE-OPERATOR-VAULT/hambazi-operator-public.pem
```

Passphrase فقط در prompt مخفی OpenSSL وارد شود؛ نه `-pass pass:...`، نه env، نه فایل passphrase و نه terminal تحت کنترل Codex یا recorder. این فایل‌های خصوصی **کلید بلندمدتِ رمزگذاری‌شدهٔ عمدی** هستند، نه فایل موقت Username/Password/PIN. cipher فایل، جای حفاظت دستگاه یا backup مستقل را نمی‌گیرد.

۳. fingerprint کلید عمومی، نه فایل خصوصی، در اختیار مرجع تأیید قرار گیرد. برای هر public key در محل خودش:

```sh
openssl pkey -pubin -in /ABSOLUTE-PATH/approved-public.pem -outform DER \
  | openssl dgst -sha256
```

فقط public keyهای تأییدشده و متفاوت، پس از مجوز جدا به trust configuration خصوصی سرور وارد می‌شوند؛ SPKI PEM با verifier فعلی سازگار است. private key یا passphrase نباید برای عامل ارسال شود. ارسال public key از همان کانالِ تأییدنشده، اعتبار هویت را به‌تنهایی ثابت نمی‌کند. تولید کلید، به‌معنی آماده‌شدن امضاکنندهٔ تعاملی نیست؛ ابزار فعلی adapter امضای انسانی آماده ندارد.

## فرایند هدف ورود تعاملی — specification آماده، ابزار هنوز آماده نیست

فرمان `admin:provision` موجود برای این نیاز اجرا نشود؛ هیچ نام script فرضی به‌عنوان فرمان آماده معرفی نمی‌شود. اجرای آینده پس از پیاده‌سازی و تست باید چنین باشد:

1. preflight فقط‌خواندنی، پیش از دریافت secret: محیط و artifact، نبود OWNER، trust anchors، backup/restore و Audit، زمان/expiry و checkpoint بیرون snapshot بررسی شود. شکست هر gate ورود اطلاعات را متوقف کند. هیچ اتصال HTTP Signup/Bootstrap اضافه نشود.
2. مالک ابزار بازبینی‌شده را در **ترمینال شخصی خارج از Codex و خارج از session recorder** اجرا کند. SSH strict host-key verification فعال بماند. دریافت از TTY محلی بدون echo/ستاره، حتی برای Username انجام شود؛ Password و PIN برای تأیید دوباره گرفته شوند. خروج/قطع ارتباط/timeout پیش از commit هیچ حسابی نسازد و ترمینال را به حالت عادی برگرداند.
3. Password فعلاً طبق schema حداقل ۱۲ و حداکثر ۲۵۶ کاراکتر؛ PIN دقیقاً شش رقم ASCII و حفظ صفر آغازین؛ Username مطابق schema موجود canonical شود. مقدار هیچ فیلد در پیام خطا یا خلاصهٔ نهایی بازتاب داده نشود. این مقادیر فقط در حافظه و کانال SSH اعتبارسنجی‌شده حرکت کنند؛ نه shell variable/export، argv، heredoc، JSON موقت، tmpfs، clipboard یا shell history. نوشتن فایل و حذف پس از کار، این شرط را برآورده نمی‌کند.
4. برنامهٔ خصوصی سمت سرور payload parsed را با command key همان realm digest کند. statement موجود به commandId، realm، Username، reason، digest و عمر حداکثر پنج دقیقه متصل است. challenge و proof نیز نباید چون Username دارند در فایل موقت یا log ذخیره شوند؛ فقط از کانال برنامه‌ایِ حافظه‌ای بین دو signer منتقل شوند. password/PIN/pepper به signerها داده نشوند. signer مالک با حضور/تأیید مالک و signer اپراتور مستقل عمل کنند؛ یک کلید جای دو کلید امضا نکند.
5. پس از بررسی امضاها، خلاصهٔ غیرمحرمانه فقط «ایجاد اولین OWNER در Staging» و شناسهٔ ceremony را نشان دهد. تأیید نهایی انسانی لازم است؛ تأیید از پیش فعال یا commit خودکار به محض ورود داده ممنوع است.
6. همان application port فعلی با role bootstrap در transaction قفل‌شده اجرا شود: Argon2id مستقل، binding یکتا، receipt و Audit اتمیک. هیچ full session خودکار ایجاد نشود. چاپ فقط status code و reference غیرمحرمانه باشد؛ crash report، dump، request body، proof دارای Username یا verifier خام وارد collector نشوند.
7. در قطع ارتباط حوالی commit، نتیجه «نامعلوم» است؛ ابتدا با reference غیرمحرمانه و خواندن receipt بررسی شود. با commandId جدید کورکورانه retry نشود و بازگشایی bootstrap از restore قدیمی مجاز نباشد. checkpoint خارج از snapshot، realm، ownerId، ownershipEpoch و ceremonyId را بدون Username/credential ثبت کند؛ ثبت checkpoint و DB تراکنش توزیع‌شده نیستند و شکست مرحلهٔ دوم نیاز به reconcile دارد.
8. مالک از مرورگر خودش و تونل معتبر وارد شود؛ قبل PIN فقط PENDING بی‌اختیار. بعد از ورود، مسیر self-service تکمیل‌شده برای **تعویض Password و PIN** استفاده شود. هر تعویض تمام نشست‌های قبلی، از جمله جاری و PENDING، را نامعتبر و ورود مجدد لازم کند. عوض‌کردن PIN به‌تنهایی Password قبلی را عوض نمی‌کند. روی OWNER واقعی آزمایش سه PIN اشتباه انجام نشود.

در Node/JavaScript نمی‌توان پاک‌شدن همهٔ کپی‌های secret در RAM را تضمین کرد؛ طول عمر process، جلوگیری از dump/swap ناامن و نبود recorder کنترل عملی‌اند. اگر سیستم مورد استفاده این شروط را نتواند تأیید کند، ceremony اجرا نشود. prompt مخفی نیز در برابر root/keylogger مخرب تضمین نیست.

### کار محدود لازم برای تغییر Password

این کار اصلاح امنیت هویتِ خود OWNER در فاز یک است، نه مدیریت رمز دیگر مدیران یا فاز دو. پیش از انتشارش باید backend/UI/contract، محدودیت reauthentication با Password و PIN فعلی، counter سه‌تلاش، version fencing در رقابت login/change/recovery، Hash Argon2id تازه و Audit اتمیک تکمیل شوند. grant runtime فقط ستون لازم باشد؛ اختیار ویرایش identity یا تغییر نقش افزوده نشود. username change در نسخهٔ فعلی وجود ندارد و جزو این اصلاح فرض نشده است.

مبنای پذیرش: password غلط counter PIN را زیاد نکند؛ موفقیت همهٔ نشست‌های قبلی را واقعاً نامعتبر کند؛ درخواست قدیمی با credentialVersion قبلی commit نشود؛ Audit failure صفر اثر؛ password قبلی پس از تغییر پذیرفته نشود. اگر تعویض اجباریِ نخستین ورود خواسته شود، policy و حالت محدود آن باید جدا تعریف و پیاده شود؛ برچسب «موقت» خودبه‌خود این رفتار را نمی‌سازد.

## قفل و بازیابی پیش از نخستین حساب

سه failure متمایز PIN، فقط بعد از Password صحیح، شمارندهٔ پایدار مالک را به سه می‌رساند و قفل دائمی می‌کند. IP، مرورگر، زمان، restart و Password/PIN صحیح قفل را باز نمی‌کنند. موفقیت کامل پیش از lock شمارنده را صفر می‌کند؛ retry همان intent یک تلاش است. تغییر PIN فعلی نیز همین counter را دارد؛ خطای Password تلاش PIN محسوب نمی‌شود.

قبل از حساب واقعی، مسیر کامل Recovery همان ابزار تعاملی باید در محیط disposable **با مجوز مستقل برای تست** بررسی شود؛ این سند اجازهٔ ساخت fixture یا credential آزمایشی تازه نیست. آزمون‌ها: قفل سوم، restart، امضای ناقص/منقضی/هدف متفاوت، منع unlock توسط runtime، تغییر PIN همان identity، revoke تمام نشست‌ها و rollback Audit. ابزار recovery فقط از مسیر اپراتوری سرور و role جدا کار می‌کند؛ API عمومی، SQL دستی برای unlock، auto-unlock و مالک دوم جایگزین آن نیستند.

**Recovery موجود Password گم‌شده را بازیابی نمی‌کند.** راه‌اندازی باید با تأیید روش امن نگه‌داری Password مالک همراه باشد؛ نباید وعده داد با reset PIN همهٔ مشکلات ورود حل می‌شوند. مسیر جدید بازیابی Password یا انتقال OWNER بدون تصمیم و qualification جدا اضافه نمی‌شود.

## Backup، کلیدها و Audit قبل از واقعی‌شدن هویت

- backup قبل از migration شامل schema نهایی Admin نیست؛ snapshot سازگار با schema ۱۶ و نقش‌ها/grantها/triggerها لازم است. `pg_dump` به‌تنهایی global roles، فایل‌های اعتماد، pepper، امضاکننده‌ها یا WAL/PITR را حفظ نمی‌کند. catalog موفق جای restore نیست.
- key inventory باید PIN pepper، command/signing key، نسخهٔ KDF، realm/issuer/audience و trust-anchor fingerprint را پوشش دهد. از دست‌دادن یا تغییر بی‌برنامهٔ pepper/KDF می‌تواند PIN صحیح را غیرقابل‌اعتبارسنجی کند. session signing-key rotation، recovery PIN و backup rotation سه عمل متفاوت‌اند.
- restore جدا و بدون اتصال به بازی/Redis زنده انجام و محدودیت roleها، شمارنده، Audit، singleton و epoch بررسی شود. checkpoint مالکیت خارج از DB مانع این برداشت شود که restore قبل enrollment اجازهٔ ساخت OWNER تازه است. نتیجهٔ restore پیش از بازگشایی با شاهد بیرونی reconcile شود.
- محل رمزگذاری backup و custody کلید decrypt باید تعیین شود؛ DB dump و pepper plaintext کنار هم یا تنها نسخه روی همان VPS کافی نیستند. raw Password/PIN در هیچ backup کاربردی وجود ندارند؛ فقط verifierهای مجاز در DB. کلیدهای رمزگذاری‌شدهٔ عمدی و vault شخصی با فایل موقت credential یکسان نیستند.
- حداقل Audit موفقیت، رد/لغو ceremony، قفل، recovery، تغییر credential و ابطال نشست‌ها باید content-free و دارای reference قابل بررسی باشد. آرشیو/retention، مسئول بررسی و رسید مستقل enrollment باید مشخص شوند. تا تصمیم retention حذف خودکار جدیدی فعال نشود؛ این به معنی تصویب نگه‌داری نامحدود نیست. vendor جدید یا ارسال پیام به اشخاص فرض نشده است.

تمدید گواهی HTTPS از نظر مسیر خروجی در گزارش انتشار باز است. گواهی فعلی برای ceremony نزدیکِ دارای TLS معتبر مانع فوری نیست، اما قبل موعد renewal باید حل شود. سلامت/expiry فعلی یک مجوز دائمی نیست. شکست‌های قدیمی check سراسری Web/secret-scan هم با این بازبینی حل‌شده اعلام نمی‌شوند.

## گام بعدی دقیق و نقطهٔ توقف

**اکنون:** مالک فقط محل custody و روش تأیید fingerprint دو public key را مشخص کند؛ secret در چت ارسال نشود. دستورالعمل تهیهٔ کلیدها بالاست، اما عامل هیچ کلیدی نساخته و نصب trust anchor روی سرور مجاز نشده است.

**پیش از درخواست ایجاد OWNER:** اصلاح محدود فاز یک برای ابزار حافظه‌ای/TTY، امضاکننده‌های مستقل، تغییر Password و Audit/تست‌های لازم باید آماده و review شود؛ سپس تغییرات سرور و تست recovery/backup مجوز مشخص خود را بگیرند. اجرای `admin:provision` فعلی با فایل موقت میان‌بُر پذیرفته‌شده نیست.

**فقط پس از گزارش سبز gateها و اجازهٔ صریح مالک:** ابزار نسخهٔ دقیق در ترمینال شخصی اجرا، اطلاعات انتخابی به‌صورت تعاملی وارد و همان یک OWNER در Staging ایجاد شود. تمام مسیرهای بالا اکنون برنامهٔ اجرا هستند، نه کار انجام‌شده یا فرمان آمادهٔ enrollment. تا آن زمان توقف؛ فاز دو آغاز نمی‌شود.

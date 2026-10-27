# ADR-079 — OWNER محافظت‌شده و مجوزهای انعطاف‌پذیر مدیران

> بازنگری اجرای فاز دوم (2026-10-27): [ADR-085](../adr/085-admin-phase-two-operations.md) و [ADR-086](../adr/086-admin-user-ban-and-session-generation.md) قرارداد عملیات/نقش‌ها و استثنای مصوب محروم‌سازی را تکمیل می‌کنند. توسعه فقط محلی مجاز است؛ این بازنگری مجوز استقرار یا تغییر OWNER نیست.

> **تصمیم جدید مراسم Staging — [ADR-084](084-staging-owner-private-ssh-ceremony.md):** دو امضای Ed25519 و فایل credential خام برای Staging با پروفایل صریح SSH/root/TTY، تأیید عمل، checkpoint و Audit خصوصی جایگزین می‌شوند؛ Recovery به Password فعلی همان OWNER نیاز دارد. backup رمزگذاری‌شده و تمرین restore خارج سرور پیش‌نیازند. این تغییر محلی است؛ نصب، حساب واقعی، public ingress و فاز دو مجاز نشده‌اند. مطالب قبلیِ دو proof در این محدوده تاریخی‌اند؛ برای محیط‌های دیگر پابرجا هستند.

> **تصمیم جدید ۲۰۲۶-۱۰-۲۶ — [ADR-083](083-admin-public-https-and-self-credential-rotation.md):** مسیر استفادهٔ عادی، Public HTTPS با احراز هویت و Reverse Proxy محدود است؛ الزام SSH-only برای مرورگر منسوخ می‌شود. Backend/DB/Redis و Bootstrap/Recovery خصوصی می‌مانند. تغییر Password و PIN خود OWNER و ابطال نشست‌ها ادامهٔ محدود فاز یک‌اند. کد/تست محلی مجاز است؛ نصب سرور، Firewall، فعال‌سازی عمومی، حساب واقعی و فاز دو تأیید نشده‌اند. نصب فعلی سرور تا مجوز جدا همان SSH-only است. این یادداشت در موضوع ingress بر بندهای تاریخی پایین مقدم است.

> **بازنگری معتبر فاز یک — ۲۰۲۶-۱۰-۲۵:** [ADR-081](081-admin-local-password-and-owner-pin.md) تصمیم جدید و مرجع احراز هویت Admin است: ورود محلی Username/Password، مرحلهٔ PIN ثابت شش‌رقمی فقط برای OWNER، قفل دائمی پس از سه PIN اشتباه و بازیابی خصوصی با دو proof مستقل. Password + PIN ثابت **MFA مستقل یا مقاوم به فیشینگ نیست**. بندهای قبلی OIDC/IdP، MFA خارجی، ورود/دعوت بر اساس subject خارجی و بازیابی provider در این سند در محدودهٔ Admin منسوخ‌اند؛ اصل OWNER/RBAC/private ingress/audit و یکپارچگی بازی حفظ است. فاز یک با تأیید صریح مالک آغاز شده؛ [گزارش اجرایی فاز یک](../implementation/admin-dashboard-phase-1.md) دامنه و شواهد جاری را مشخص می‌کند. فاز دو، حساب واقعی و deployment مجوز ندارند. مطالب «فقط Markdown/فاز صفر» در بخش‌های قدیمی، سابقهٔ زمان تدوین‌اند.

- **Status:** تصمیم جهت‌گیری معماری بر اساس درخواست صریح مالک در ۲۰۲۶-۱۰-۲۵؛ specification مستندی برای پیاده‌سازی آینده. پروفایل زمان و integration/recovery نیازمند qualification هستند؛ هیچ activation یا حسابی ایجاد نشده است.
- **Owner:** مالک پروژهٔ HamBazi؛ طراحی فنی و امنیت با تیم مهندسی، بدون تعیین حساب/شخص اجرایی در این سند.
- **Date:** 2026-10-25
- **Supersedes:** بخش‌های نقش/assignment/approval مدیران در پیشنهاد ADR-078؛ به‌طور محدود، الزام grant صریح برای همهٔ principals در ADR-039 را برای OWNER ثبت‌شده جایگزین می‌کند. الزامات auth/MFA/network/audit/owner-port/data integrity در ADR-039 بدون تغییر معتبرند.
- **Related:** ADR-013، ADR-014، ADR-023، ADR-024، ADR-039، ADR-078؛ [طراحی تفصیلی](../architecture/admin-access-control.md).

## Context

پیشنهاد قبلی root مستقل نداشت، نقش wildcard را برای همه رد می‌کرد و عملیات دو‌نفره در حضور یک مدیر متوقف می‌شد. مالک صریحاً authority کامل فعلی/آینده، مدیریت مدیران و نقش‌های سفارشی، حفاظت از حساب خود و مسیر تصمیم نهایی بدون وابستگی به مدیر دوم را خواسته است. این تغییر باید با MFA، audit و invariant بازی سازگار بماند؛ ساخت حساب یا تغییر محیط فعلاً ممنوع است.

## Decision

1. OWNER یک root binding یکتا و محافظت‌شده در هر realm است؛ role عادی، claim provider یا `isOwner` قابل PATCH نیست. تمام capabilityهای معتبر ثبت‌شدهٔ فعلی/آینده برای او مجازند؛ grant/deny/scope عادی مالک را محدود نمی‌کنند. permission ناشناخته و endpoint فاقد قرارداد برای همه deny است.
2. OWNER از authentication، revocation، MFA، private ingress، audit، quota، دادهٔ مجاز، production HOLD و rule/transaction بازی مستثنا نیست. دسترسی کامل قابلیت مدیریتی به معنی raw data/SQL یا تغییر نتیجه و audit نیست.
3. lifecycle مدیران، role CRUD، assignment/override و نشست دیگران `OWNER_ONLY` و غیرقابل واگذاری‌اند. Super Admin نیز حق تغییر/حذف/disable/revoke/unbind مالک یا ارتقای خود را ندارد. root از حساب بازیکن مستقل و در CRUD عمومی حتی توسط خود مالک قابل حذف نیست.
4. برای سایر مدیران role template و role سفارشی، permissionهای view/create/edit/manage/approve مستقل و ALLOW/DENY فردی با scope تایپ‌شده تعریف شود. grant صریح لازم است و deny منطبق غالب؛ permission جدید به هیچ نقش عادی خودکار اضافه نمی‌شود.
5. permissionهای فعال از primary و revision جاری در هر authorization gate بررسی شوند؛ job/retry/delivery نیز reauthorize شوند. از commit تغییر، gate جدید حق stale authorization ندارد؛ lease/قطع اتصال فعال حداکثر ۵s. عملیات از قبل admitted قابل undo برگشتی فرض نمی‌شود و مرز آن audited است.
6. OWNER_FINAL مسیر عادی جایگزین quorum دو نفر برای مالک است: challenge عمل‌محور، reauthentication تازه و مقاوم به phishing، reason، digest/revision/environment binding، مصرف یک‌بار و admission/outcome audit. self-approval غیرمالک همچنان ممنوع است. این مسیر دو هویت جعلی یا bypass flag تولید نمی‌کند.
7. profile طراحی OWNER_FINAL: challenge ۱۲۰s، freshness proof حداکثر ۶۰s بعد از challenge، execution grant ۶۰s. emergency اختیاری از پیش enrolled، حداکثر ۱۰min و scope محدود دارد؛ تنهابودن مالک دلیل اضطرار نیست. provider و واقعی‌بودن forced reauth باید قبل اجرا qualify شوند.
8. bootstrap خصوصی، manifest هویت زمان‌دار خارج از کد، proof هویت+کنترل نصب، singleton transaction و audit لازم دارد؛ first-login-wins و seed owner رد می‌شوند. recovery همان root را حفظ و ownershipEpoch/sessionها را rotate/revoke می‌کند؛ مقام Owner به مدیر دیگر واگذار نمی‌شود.
9. schema/API صرفاً در اسناد مشخص شوند. ساختار Modular Monolith، PostgreSQL/Redis/Worker، application portها و session بازیکنان ADR-014 تغییری ندارند.

## Alternatives

| گزینه                                         | دلیل انتخاب نشدن                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| OWNER همان role قابل‌ویرایش با permission `*` | حذف role، mass assignment یا grant wildcard می‌تواند مالک بسازد/حذف کند؛ binding مستقل لازم است   |
| الزام دو انسان حتی برای مالک                  | با نیاز صریح ادارهٔ پلتفرم توسط مالک یگانه ناسازگار است                                           |
| `if owner return true` در ابتدای middleware   | auth، audit و guardهای domain را دور می‌زند؛ branch مالک فقط لایهٔ entitlements را جایگزین می‌کند |
| مالک با ID/email ثابت در source یا migration  | ناامن، غیرقابل rotation و نامناسب برای جداسازی محیط                                               |
| role و permission فقط در JWT تا expiry        | revoke/change نشست فعال را با زمان قابل‌آزمون اعمال نمی‌کند                                       |
| خودخدمتی Super Admin برای assignment          | قدرت ارتقای خود و هدف‌گرفتن مالک ایجاد می‌کند؛ lifecycle دسترسی فعلاً مالک‌محور است               |
| Break-glass برای هر عملیات تک‌مدیره           | مسیر اضطراری را دائمی می‌کند؛ OWNER_FINAL مسیر روزمره است                                         |

## Consequences

مالک حتی به‌تنهایی می‌تواند تصمیم پرخطر معتبر بگیرد و همهٔ قابلیت‌های آینده را داشته باشد. دیگر مدیران least privilege و explicit scopes دارند. مصالحهٔ حساب OWNER اثر وسیع دارد؛ MFA تازه، کلید پشتیبان مستقل، session revoke، proof عمل‌محور و audit این ریسک را کاهش می‌دهند ولی آن را حذف نمی‌کنند. اختیار host/DBA/IdP بیرون از برنامه نیز باید جدا کنترل شود.

ارزیابی مجوز از primary هزینهٔ خواندن محدود ایجاد می‌کند و وابستگی به دسترسی DB دارد؛ fail closed پذیرفته می‌شود و مسیر gameplay به Admin وابسته نمی‌شود. تغییر revoke نمی‌تواند اثر قبلاً commit/admitted را عقب برگرداند. session عادی، recovery provider و retention همچنان تصمیم محیطی‌اند؛ اعداد profile این ADR اجرای بالفعل یا SLO اندازه‌گیری‌شده نیستند.

## Acceptance

پیش از اجرا/فعال‌سازی باید AC-01…AC-22 سند تفصیلی اثبات شوند: root یکتا و غیرقابل حذف توسط دیگران؛ new permission owner-allow/others-deny؛ role/override scope و deny precedence؛ revocation چند node با Redis ازکارافتاده و ≤۵s برای اتصال؛ bootstrap/recovery/replay؛ OWNER_FINAL بدون مدیر دوم؛ رد proof قدیمی و تغییر digest؛ audit outage صفر اثر؛ یک اثر در crash/retry؛ منع دورزدن hidden-state و Match writer؛ UI فارسی و اثر واقعی تغییر دسترسی.

این ADR تعیین‌کنندهٔ حساب واقعی مالک، credential یا مجوز deployment نیست. تمام تغییرهای این درخواست محدود به Markdown هستند.

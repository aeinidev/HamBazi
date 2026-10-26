# برنامهٔ قرارداد Admin — baseline مفهومی فاز صفر

> **بازنگری معتبر فاز یک — ۲۰۲۶-۱۰-۲۵:** [ADR-081](../adr/081-admin-local-password-and-owner-pin.md) تصمیم جدید و مرجع احراز هویت Admin است: ورود محلی Username/Password، مرحلهٔ PIN ثابت شش‌رقمی فقط برای OWNER، قفل دائمی پس از سه PIN اشتباه و بازیابی خصوصی با دو proof مستقل. Password + PIN ثابت **MFA مستقل یا مقاوم به فیشینگ نیست**. بندهای قبلی OIDC/IdP، MFA خارجی، ورود/دعوت بر اساس subject خارجی و بازیابی provider در این سند در محدودهٔ Admin منسوخ‌اند؛ اصل OWNER/RBAC/private ingress/audit و یکپارچگی بازی حفظ است. فاز یک با تأیید صریح مالک آغاز شده؛ [گزارش اجرایی فاز یک](../implementation/admin-dashboard-phase-1.md) دامنه و شواهد جاری را مشخص می‌کند. فاز دو، حساب واقعی و deployment مجوز ندارند. مطالب «فقط Markdown/فاز صفر» در بخش‌های قدیمی، سابقهٔ زمان تدوین‌اند.

وضعیت: **Specification غیرقابل‌اجرا** در ۲۰۲۶-۱۰-۲۵. OpenAPI، Zod schema، migration، permission registry اجرایی یا frozen baseline در این فاز ایجاد نشده‌اند. مرجع [معماری پنل](../architecture/admin-dashboard.md)، [دسترسی](../architecture/admin-access-control.md) و [گزارش فاز صفر](../implementation/admin-dashboard-phase-0.md) است.

## ۱. مرز transport و authority

- origin محصول `https://admin.hambazi.top` و prefix `/v1/admin`؛ نام محیط test/staging هنوز تعیین نشده است. listener خصوصی و same-origin proxy؛ هیچ route روی listener عمومی بازیکن register نشود.
- auth protocol/session endpoints به session state معتبر و policy خود نیاز دارند؛ product reads permission مستقل می‌خواهند. هویت، realm، environment، root binding و assurance از config معتبر و storage server می‌آیند؛ body یا query حق انتخاب principal/role/key source ندارند.
- DTO/API با Zod فعلی و OpenAPI 3.1 تولید/بررسی خواهد شد. generated Admin baseline جدید مستقل است؛ baselineهای auth/player موجود تغییر یا regenerate برای دورزدن review نمی‌شوند.
- server-side validation، CSRF/Origin و resource limits حتی برای OWNER لازم‌اند. permission هر handler در registry ثبت شود؛ unregistered operation/permission fail closed، registered future capability owner-allow و دیگران explicit-only.

## ۲. شکل مفهومی داده‌ها

این جدول قرارداد semantically لازم را مشخص می‌کند، نه interface TypeScript اجراشده.

| DTO                    | دادهٔ مجاز                                                                                                                                   | دادهٔ ممنوع / invariant                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `AdminSessionViewV1`   | schemaVersion، session reference غیر bearer، operator reference، issued/expires، assurance خلاصه، normal/emergency، version/epoch            | cookie/JWT، token IdP، assertion، secret، IP/device fingerprint خام                            |
| `AdminAccessViewV1`    | schemaVersion، isOwner محاسبه‌شده، policy/authz revision، permission/scope/projectionهای مؤثر                                                | claim client authority نیست؛ permission catalog فقط release-defined؛ session revoked بدون view |
| `AdminReadPageV1`      | schemaVersion، items allowlisted، nextCursor یا null، asOf و environment                                                                     | raw Prisma row، raw JSON state یا total count بی‌سقف                                           |
| `AdminMetricV1`        | key ثبت‌شده، مقدار با واحد یا null، validity، asOf، source، scope/period                                                                     | unknown را صفر نکن؛ دادهٔ node-local را CCU یکتا معرفی نکن                                     |
| `AdminIntentV1`        | schemaVersion=1، commandId UUID، expectedVersion یا expectedPolicyRevision، reasonCode و payload خاص عمل                                     | actorId/isOwner/role/issuer/JWKS/MFA boolean، SQL و handler دلخواه                             |
| `AdminOperationViewV1` | operationId، وضعیت، target reference، expected/result revision، authorityMode، outcome code، timestamps                                      | full request/response/hidden state، «timeout=failed» یا success بدون receipt                   |
| `AdminDecisionV1`      | challenge/operation reference، digest/target/policy/ownership bindings، proof reference سروری، reasonCode                                    | assertion خام، client-selected expiry، `ownerOverride=true`                                    |
| `AdminAuditEventV1`    | eventId، operationId، actor/target opaque reference، capability، revision، reason/outcome code، server time، authorityMode                   | token/hash احراز هویت، متن chat، deck/RNG، raw error و متن نامحدود                             |
| `AdminOutcomeV1`       | eventId، operationId، actor/command reference، owner aggregate/target، type/version، resultingRevision، fixed outcome/error، correlation امن | اطلاعات مخفی، payload فرمان، text گفتگو یا credential در outbox/queue                          |

UUID، canonicalization و version counter از convention فعلی قراردادها پیروی کنند؛ timestamp API به صورت UTC با representation واحد در OpenAPI اجرایی تثبیت شود. countهای بزرگ decimal string؛ cursor opaque و به filter/sort/scope مرتبط است، خودش مجوز نیست. queryهای تکراری/ناشناخته رد؛ sort/page/filter و زمان سقف دارند. enum/error جدید additive به قرارداد feature اضافه شود و generic fallback client باقی بماند.

خطای فعلی پروژه شکل `ok=false → error:{code,message,retryable}` دارد. Admin همان شکل را حفظ می‌کند؛ raw validation issue/exception به message نمی‌رود. کدهای Admin هنوز در union/factory مشترک موجود نیستند؛ در فاز یک باید feature-owned schema/factory یا extension صریح و تست‌شدهٔ قرارداد انتخاب شود. unknown error در UI fallback امن دارد و retryable به معنای صدور commandId تازه نیست.

## ۳. نقشهٔ capability به owner و مرحله

نام‌های این جدول قرارداد هدف‌اند. یک port موجود که خروجی نزدیک دارد معادل port مدیریتی موجود تلقی نمی‌شود. scope و registry قبل از handler enforce می‌شوند و owner projection نیز bound/allowlist می‌کند.

| فاز       | مسیر نمونه زیر `/v1/admin`                     | permission / authority                                  | مالک و حالت موجود                                                                     |
| --------- | ---------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ۱         | auth login/callback و `GET /session`           | protocol احراز هویت مستقل؛ هیچ نقش از DTO               | Admin جدید؛ reuse session بازیکن ممنوع                                                |
| ۱         | `GET /me/access`، مشاهده/خروج نشست خود         | self-session policy ثبت‌شده، root/permission view معتبر | Admin جدید؛ logout نباید به grant محصول وابسته شود                                    |
| ۱         | `GET /overview`                                | `overview.view`؛ projection تابع scope                  | facade Admin با portهای diagnostics موجود + source/freshness؛ overview جدید           |
| ۱         | `GET /users`، `/users/:id`                     | `users.view` + field/row scope                          | Users: admin read port جدید؛ identity/profile بازیکن جایگزین نیست                     |
| ۱         | `GET /games`                                   | `games.view`                                            | Games: read ترکیبی موجود/جدید؛ نصب engine، readiness و admission جدا                  |
| ۱         | `GET /rooms`، `/rooms/:id`                     | `rooms.view`                                            | Rooms: list/detail metadata جدید؛ diagnostics aggregate موجود                         |
| ۱         | `GET /matches`، `/matches/:id`                 | `matches.view`                                          | Matches: metadata list/detail جدید؛ state/event payload ممنوع                         |
| ۱         | `GET /monitoring/summary`                      | `monitoring.view`                                       | composition-safe facade؛ fixed targets؛ proxy metrics خام ممنوع                       |
| ۱         | `GET /audit-events`                            | `audit.view`                                            | Admin جدید؛ فقط audit پایهٔ پیاده‌شده قابل نمایش                                      |
| ۱         | `GET /permissions`                             | registry projection طبق self access/policy              | Admin registry جدید؛ OWNER_ONLY grantable نیست                                        |
| ۱         | `GET /statistics/summary` در صورت scope فاز ۱  | `statistics.view`                                       | Leaderboard aggregate port جدید و edge مصوب؛ در نبود آن unavailable، نه impersonation |
| ۲         | operators/invitations/roles/bindings/overrides | OWNER_ONLY + OWNER_FINAL برای تغییر امنیتی              | Admin جدید؛ root target protection و CAS                                              |
| ۲         | مشاهده/ابطال نشست دیگران                       | OWNER_ONLY؛ session metadata و epoch                    | Admin جدید؛ نه revoke session مالک توسط غیرمالک                                       |
| ۲         | approvals/owner-decisions                      | permission approve مستقل یا root decision               | Admin جدید؛ policy action-bound؛ self-approval غیرمالک رد                             |
| ۲         | availability/flag/settings changes             | permission دقیق view/edit/manage/approve                | Games برای availability؛ Admin برای registry عمومی؛ owner-local fence لازم            |
| ۲         | room closure                                   | `rooms.closure.manage` و approval policy                | Rooms port جدید؛ CAS/start race و receipt/outcome                                     |
| ۲         | match termination                              | `matches.termination.create/approve` یا OWNER_FINAL     | Matches lifecycle موجود، admin wrapper/outcome/receipt correlation جدید               |
| ۳         | restriction/report/evidence                    | permission مجزا با OD-005 و policy مصوب                 | Users/Chat و workflow Admin؛ API محتوا فعلاً بسته                                     |
| ۳         | rebuild request                                | `statistics.rebuild.create/approve` یا OWNER_FINAL      | Leaderboard/Worker موجود با command wrapper جدید؛ no arbitrary job payload            |
| مصوب بعدی | emergency/recovery/Bot/support/export          | private ceremony و capability همان operation            | بعد از pre-enrollment/drill یا ADR مربوط؛ اکنون route ایجاد نمی‌شود                   |

ثبت permission و محدودیت پنج سطح action در [ماتریس تفصیلی](../architecture/admin-access-control.md) مرجع است. scope از environment deployment و target خوانده‌شدهٔ owner استخراج شود؛ `gameId` body به‌تنهایی کافی نیست. برای OWNER entitlement scope عادی اعمال نمی‌شود، اما محیط session، private network و data policy همچنان الزام‌اند.

## ۴. application port و dependency plan

| surface                        | contract هدف                                                                      | اجازهٔ persistence                                                    |
| ------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Admin Identity/Session         | verify login، resolve root/operator، inspect/revoke، current authz snapshot       | فقط جدول‌های owned Admin؛ auth player ممنوع                           |
| Admin Policy                   | registered capability، effective access، protected target، scopes و decision mode | role/binding/override/policy head خودش                                |
| Users Admin Read               | list/detail/count bounded، فقط فیلدهای مصوب                                       | repository Users؛ هیچ query در Admin روی User table                   |
| Games Admin Read/Change        | desired/effective availability و revision/readiness                               | repository Games؛ readiness از source قابل اعتماد                     |
| Rooms Admin Read/Close         | metadata و pre-start closure                                                      | repository Rooms؛ no Match snapshot                                   |
| Matches Admin Read/Terminate   | metadata/pins/connection summary، lifecycle guarded و outcome                     | repository Matches؛ هیچ state raw در خروجی                            |
| Leaderboard Admin Read/Rebuild | counts/generation read و request محدود                                            | projection owner؛ no direct Match table access                        |
| Admin Audit/Operations         | admit، append outcome، read timeline و reconcile                                  | audit append-only و own workflow/receipts                             |
| Monitoring input               | snapshot ثابت، validity و asOf                                                    | infrastructure composition و public diagnostics؛ no generic fetch URL |

در فاز یک باید `admin` workspace و database owner/scope در checker ثبت شوند؛ checker feature boundaries اکنون فقط web را می‌شناسد و باید برای admin fixture داشته باشد. edge فعلی Admin به users/games/rooms/matches محدود است؛ `admin→leaderboard` برای آمار و هر edge دیگر باید صریح و reviewشده با positive/negative test اضافه شود. dependency injection استثنای این قاعده نیست. Worker فقط export مشخص Admin/outcome در صورت نیاز فاز مربوط می‌گیرد، نه startup یا repository داخلی.

## ۵. effect، approval و compatibility

شناسهٔ mutation به actor + commandId + normalized non-secret digest بسته می‌شود؛ `Idempotency-Key` اگر پذیرفته شد باید با commandId برابر باشد. payload متفاوت با کلید یکسان conflict است. expectedVersion مربوط به target و expectedPolicyRevision مربوط به دسترسی جدا هستند. `ownershipEpoch` در تصمیم ریشه مانع اعتبار proof قدیمی پس از recovery است.

وضعیت operation در schema اجرایی باید ماشین حالت دقیق داشته باشد. فاز صفر semantics را تثبیت می‌کند: pending approval، authorized execution، commit قطعی، denied/expired، failed-without-effect و outcome نامعلوم درحال reconciliation از هم متمایزند. timeout، علت success یا failed-without-effect نیست. 202 یعنی پذیرفته‌شدن workflow، نه اعمال تغییر؛ success فقط با receipt مالک. HTTP 401 برای identity نامعتبر، 403 برای فقدان authority پس از احراز و 404 برای target ناموجود/غیرقابل‌افشا مطابق policy ثابت هر resource باشد؛ enumeration رفتاری بررسی شود.

audit admission قبل از owner effect؛ effect+receipt+outcome در transaction محلی owner؛ publish بعد commit؛ outcome با eventId dedupe می‌شود. در bootstrap که داده‌ها همگی Admin-owned هستند، credential ceremony و transaction واحد محدود، binding/receipt/audit را اتمیک می‌سازند. credentialهای دو pool تراکنش مشترک فرض نشوند. session revocation جدید session قدیمی را با activate دوباره زنده نمی‌کند.

outcome نامعلوم فقط با همان operation/receipt بررسی شود. اگر proposer غیرمالک مجوزش را از دست داده، مالک برای تصاحب تصمیم باید preview و operation متعلق به خودش را صریح و با reference قبلی، پس از reconciliation، بسازد؛ actor اصلی بازنویسی نمی‌شود. این طراحی مانع double effect و جعل audit است.

قراردادهای جاری REST/Socket بازی و MATCH_FINISHED_V1/V2 تغییر نمی‌کنند؛ Admin event با type/version مستقل اضافه خواهد شد. producer/consumer و baseline در فاز اجرای همان قابلیت ساخته می‌شوند؛ handler قدیمی تا drain باقی می‌ماند. migration additive و expand/backfill/contract با overlap، بدون down destructive است.

## ۶. ورودی‌های قابل‌پذیرش برای فاز یک

پیش از اجرای endpoint باید exact limits و schema/type/time representation در همان PR/فاز تعیین و تست شود؛ آن‌ها در فاز صفر به‌صورت runtime فرض نمی‌شوند. پایهٔ بررسی آماده است: source ownership، permission و projection هر read، code/error envelope، current primary authz و حالت degraded تعریف شده‌اند. open provider/network/session/retention از [decision register](../implementation/admin-dashboard-phase-0.md) پیگیری می‌شود.

مجموعهٔ تست هدف: schema strict، error safe، registry missing-handler deny، public-listener absence، field/row/scope isolation، cursor/filter binding، unknown metric، DTO canary leak و compatibility baseline. برای runtime آینده AC-01…AC-22 و threat mapping معتبرند. **هیچ baseline قابل‌اجرا یا تست پاس‌شدهٔ Admin با این سند ادعا نمی‌شود.**

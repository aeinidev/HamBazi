# بازسازی فاز چهارم مدیریت بازی، اتاق و Match

مبنای این سند طرح ۴.۱ تا ۴.۶ تأییدشده در همین گفت‌وگو و مجوز صریح بازسازی محلی در ۲۰۲۶-۱۱-۰۴ است. تصویب دوبارهٔ همان دامنه یا استقرار از آن استنباط نمی‌شود.

## هدف و مرز

مشاهدهٔ پیشرفته و کنترل امن Games/Rooms/Matches، بازیکنان، تاریخچهٔ غیرمحرمانه و رسیدگی قابل پیگیری به وضعیت مشکوک. Match همان مسابقهٔ یک بازی است، نه tournament. فازهای ۱ تا ۳، OWNER، احراز هویت محلی، PIN و RBAC/Audit فعلی حفظ می‌شوند. فقط توسعه و fixture محلی؛ بدون SSH/سرور/داده یا credential واقعی، استقرار و فاز پنجم.

## رویکردها

۱. وصلهٔ UI Claude: مردود؛ search بدون API و تغییر قرارداد freeze‌شده دارد.
۲. بازسازی محدود با public port ماژول مالک و مسیر/schema جدید: انتخاب متناسب با طرح مصوب؛ منطق writer/approval قبلی استفاده می‌شود.
۳. سرویس/DB/queue جدید: مردود؛ نیاز و مجوز ندارد.

## ۴.۱ قرارداد، مالکیت و مجوز

- `/v1/admin/games/search`, `/rooms/search`, `/matches/search`: schemaVersion=1، asOf، حداکثر ۵۰ آیتم، cursor مرتب و پایدار بر ID؛ فیلتر در DB پیش از pagination و scope. query سخت‌گیرانه؛ limit=1..50؛ تاریخ ISO و بازهٔ معتبر؛ شناسه‌های Room/Match/User از نوع UUID.
- شکل فیلدها/فرمان‌ها و row/page قدیمی v1 ثابت می‌ماند؛ فقط واژگان registry مجوزها طبق ADR-079/085 به‌صورت صریح گسترش می‌یابد. این تغییر enum در DTOهای مدیریت مستند است و ادعای ثبات بایت‌به‌بایت همهٔ schemaها نداریم؛ responseهای جدید typed و strict هستند. OpenAPI مسیرهای جدید و generated document را ثبت می‌کند؛ baseline قدیمی بدون دستکاری و compatibility check الزامی است.
- `/games/:id/details`: releaseStatus جدا از admissionStatus، ظرفیت و قابلیت‌ها و نسخهٔ تنظیم؛ بدون configJsonb. نسخه‌های نصب‌شده فقط از registry عمومی قابل اثبات نشان داده شوند؛ نسخهٔ Match همیشه pins همان Match است.
- `/rooms/:id/details`: ظرفیت، host، status/version، زمان‌ها و startedMatchId؛ بدون invite code و credential.
- `/matches/:id/details`: roomId nullable، نوع، status/version/seq، زمان‌ها و pins؛ بدون stateJsonb/reconnectPolicyJsonb/result payload.
- roster: `/rooms/:id/players` و `/matches/:id/players` با حداکثر ۶۴ عضو و تشخیص overflow؛ فقط userId/seat/agentType/readiness/connection metadata مجاز. لینک پروفایل تنها با users.view.
- `/matches/:id/history`: cursor seq، فقط metadata رویدادهای allowlist lifecycle/disconnect/reconnect/bot takeover و placement/winner ثبت‌شدهٔ بازیکنان؛ بدون payloadJsonb، raw events، chat، کارت، نقش، RNG و replay مخفی حتی پس از پایان.
- diagnostics: `/rooms/:id/diagnostics` و `/matches/:id/diagnostics` فقط مشاهده. از expiry/deadline ثبت‌شده استفاده می‌شود؛ هیچ threshold جهانی یا تشخیص قطعی خرابی اختراع نمی‌شود.
- مجوز پایه games.view/rooms.view/matches.view حفظ؛ players/history/diagnostics مجوز صریح جدید همان resource می‌گیرند. OWNER همهٔ مجوزهای ثبت‌شده را دارد؛ نقش‌های دیگر خودکار grant نمی‌گیرند. scope بازی و deny در Backend پیش از query اعمال و permission/session در هر درخواست recheck می‌شود.

## ۴.۲ تا ۴.۴ داده و ایمنی

هر repository جدید فقط در Games/Rooms/Matches مربوط قرار می‌گیرد و public index/module port صادر می‌کند. composition فقط این portها را وصل می‌کند. reader ستون‌های محدود و timeout فعلی ۲s را دارد؛ مجوز عمومی جدول/hidden payload داده نمی‌شود. هیچ query مستقیم Admin به جدول ماژول دیگر نیست.

search بازی ID/slug/title محدود است؛ Room/Match با شناسهٔ دقیق یا game ID و فیلترهای status/game/date/player مشخص جستجو می‌شوند. جستجوی مبهم UUID یا wildcard دلخواه قبول نمی‌شود. pagination scope را تغییر نمی‌دهد و مجموع COUNT سنگین نداریم. snapshot جزئیات/roster از read-only transaction مالک است و asOf فقط مشاهدهٔ committed را نشان می‌دهد، نه تضمین وضعیت آینده.

تشخیص NO_SIGNAL/SUSPECTED/UNKNOWN دارای reason و asOf است: expiry گذشتهٔ اتاق WAITING/FULL یا reconnect deadline گذشته فقط SUSPECTED؛ نبود deadline قابل استناد UNKNOWN. وضعیت Redis/لحظه‌ای به شکل سالم ساختگی نمایش داده نمی‌شود. تشخیص هیچ اثر خودکار ندارد.

GAME_AVAILABILITY فقط پذیرش جدید در دامنهٔ انتشار قبلی؛ ROOM_CLOSE فقط WAITING/FULL بدون Match شروع‌شده؛ MATCH_TERMINATE با همان writer lock/version و بدون برنده/نتیجه/Undo. request → reauth/approval → explicit execute → receipt/Audit/UNKNOWN/reconcile موجود حفظ است. خطای Audit قبل effect بسته می‌ماند؛ شکست بعد commit با receipt قابل reconcile است، نه موفقیت یا شکست جعلی. تنظیم ruleset/engine/result/seat و force-repair DB مجاز نیست.

## ۴.۵ UI

fa-IR، dir=rtl، Vazirmatn و رنگ‌های فعلی Midnight Neon؛ accent طلایی و cyan محدود. فهرست‌های resource و جزئیات جدا، فیلترهای برچسب‌دار، loading/empty/error/stale و تازه‌سازی صریح؛ IDهای bdi و تاریخ ISO در wire همراه نمایش فارسی با منطقهٔ زمانی روشن. جدول scroll داخلی در موبایل، بدون overflow صفحه و با keyboard/focus/reduced-motion. requestهای قبلی هنگام تعویض resource یا سلب مجوز abort و داده/فیلتر محرمانه در خروج پاک می‌شوند. raw credential در fixtureهای عمومی/گزارش ذخیره نمی‌شود.

## ۴.۶ پذیرش و انتشار

TDD واقعی RED→GREEN برای schema/query/scope/projection/UI؛ تست DB با role reader، منع state/payload SELECT و write، race و retryهای writer قبلی، API default deny/CSRF/pending و مرورگر روی Backend ایزوله. بدون افزایش Timeout، skip جدید یا MSW/service تازه. قراردادهای قدیمی و فازهای قبل، lint/format/typecheck/build/test و Qualification استاندارد با همان کنترل‌ها اجرا شوند. هر failure و gate اجرا‌نشده صریحاً NO-GO ثبت می‌شود.

ایمیج‌های candidate فقط محلی build/scan می‌شوند. استقرار به بکاپ کامل رمزگذاری‌شدهٔ تازه، کپی خارج سرور، receipt بازیابی واقعی همان archive، grantهای محدود، امنیت معتبر و مجوز جدا وابسته است. افزودن کلیدهای مجوز، هماهنگی UI/Backend را لازم می‌کند. پس از ذخیرهٔ ROLE_SAVE/ADMIN_ACCESS دارای کلید جدید، تاریخچه نیز به parser سازگار نیاز دارد؛ revoke فعلی کافی نیست و rollback زیر کف سازگاری Task 1 ممنوع است. artifact بازگشت باید همان vocabulary/parser را حفظ کند. rollback ابتدا binary سازگار و grantهای قبلی؛ بدون down migration/حذف Audit/restore روی DB زنده. ظرفیت/load/stress/soak و QA زندهٔ معوق فاز سوم همچنان بازند و با موفقیت fixture بسته نمی‌شوند.

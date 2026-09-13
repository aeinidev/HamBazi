# AGENTS.md

این فایل راهنمای عامل‌های کدنویسی برای مخزن HamBazi است. دامنهٔ آن کل مخزن است. مرجع معماری پروژه، `docs/ARCHITECTURE.md` است؛ این راهنما فقط قواعد اجرایی قابل استنباط از همان سند را خلاصه می‌کند.

## 1. محصول و محدودهٔ MVP

HamBazi یک Game Hub چندنفره برای Telegram Bot و Telegram Mini App است. مسیر اصلی MVP چنین است:

`Account → Find/Invite → Play Coup → Finish → Stats`

MVP شامل حساب و پروفایل، فهرست بازی‌ها، Coup، لابی مشترک، matchmaking، اتاق خصوصی، بازی realtime، reconnect و Bot takeover، چت متنی، leaderboard و آمار است.

موارد زیر خارج از MVP هستند و فقط با درخواست صریح یا تصمیم معماری جدید پیاده‌سازی شوند:

- TON، کیف پول، پرداخت، Stars و اقتصاد؛
- tournament، voice، friends/clans، store/skins و achievement پیشرفته؛
- Kubernetes، Kafka، Elasticsearch و استقرار microservice؛
- anti-cheat مبتنی بر ML.

## 2. ساختار مورد انتظار مخزن

```text
hambazi/
  apps/
    api/       # REST، WebSocket و application use cases
    bot/       # Telegram orchestration؛ بدون business rule
    web/       # Telegram Mini App
    worker/    # outbox، timeout، stats و cleanup
  packages/
    contracts/
    validation/
    database/
    game-core/
    games/
      coup-engine/
    config/
    shared/
  tooling/
    eslint/
    typescript/
  infra/
    docker/
    scripts/
  docs/
    architecture/
    adr/
```

ماژول‌های backend در `apps/api/src` حول قابلیت‌های `auth`، `users`، `games`، `rooms`، `matchmaking`، `matches`، `realtime`، `presence`، `chat`، `leaderboard`، `admin` و `health` سازمان‌دهی می‌شوند. قابلیت‌های frontend در `apps/web/src/features` و UI مخصوص Coup در `apps/web/src/games/coup` قرار می‌گیرد.

فایل جدید را در نزدیک‌ترین app/package مالک آن قرار دهید. کد بازی‌-خاص را وارد قابلیت‌های عمومی Room، Matchmaking، Match، Presence، Chat یا User نکنید.

## 3. پشتهٔ فنی تثبیت‌شده

| حوزه | فناوری |
|---|---|
| زبان مشترک | TypeScript |
| Web | React، Vite، TanStack Query، Zustand، Tailwind CSS |
| Backend | NestJS با Fastify |
| Realtime | Socket.IO |
| Telegram Bot | grammY |
| داده | PostgreSQL و Prisma |
| دادهٔ موقت/صف | Redis و BullMQ |
| تست | Vitest و Playwright |
| لاگ و مانیتورینگ | Pino، Sentry، uptime monitoring |
| Monorepo | pnpm Workspaces و Turborepo |
| استقرار MVP | Docker، Cloudflare، VPS یا Managed DB |
| قراردادها | OpenAPI و AsyncAPI/event catalog |

برای validation، سند «Zod یا JSON Schema» را باز گذاشته است. انتخاب موجود در کد را دنبال کنید و بدون ADR یا نیاز مشخص، ابزار دوم را وارد نکنید. نسخهٔ dependencyها باید stable و compatible باشد و در lockfile تثبیت شود.

Phaser فقط برای بازی‌های canvas-heavy در نظر گرفته شده است؛ UI فعلی را به‌صورت عادی با React بسازید مگر نیاز بازی خلاف آن را ثابت کند.

## 4. قواعد معماری

معماری MVP یک **Modular Monolith** با مرزهای enforce‌شده است.

- هر ماژول مالک domain model، use case و repository interface خود است.
- ارتباط synchronous بین ماژول‌ها فقط از application port عمومی انجام می‌شود؛ ارتباط asynchronous با domain event نسخه‌دار.
- فقط public surface مستندشده، مانند `index.ts` یا application port، قابل import است.
- import از internals ماژول دیگر، استفادهٔ مستقیم از repository آن یا query مستقیم روی جدول‌های آن ممنوع است.
- Prisma modelها را به قرارداد مشترک بین ماژول‌ها تبدیل نکنید.
- `packages/shared` فقط برای primitive، error code و قرارداد واقعاً مشترک است؛ business rule یا مجموعه‌ای از utilityهای نامرتبط در آن قرار ندهید.
- Bot و Realtime Gateway adapter هستند و business logic را مالک نمی‌شوند. Gateway در MVP مرز منطقی داخل `apps/api` است، نه سرویس مستقل.
- زیرساخت platform-generic را برای بازی جدید کپی نکنید؛ بازی از Game Module/adapter خود به قابلیت‌های مشترک متصل می‌شود.
- استخراج microservice فقط پس از شواهد load، ownership یا نیاز مستقل به deploy قابل بررسی است.

وابستگی‌های ممنوع باید با تنظیمات ESLint/dependency-boundary موجود در مخزن کنترل شوند. Engine نباید به framework یا infrastructure وابسته شود.

## 5. قرارداد Game Module و Engine

هر بازی کامل باید این اجزا را داشته باشد:

- manifest شامل `id`، `slug`، `title`، `minPlayers`، `maxPlayers`، قابلیت‌های matchmaking/private room/chat/voice و وضعیت بازی؛
- descriptor نسخه شامل `engineVersion`، `stateSchemaVersion` و schema فرمان/رویداد؛
- engine خالص، frontend adapter، bot policy، timer/reconnect policy و result mapper استاندارد؛
- `PlayerView` و در صورت نیاز `SpectatorView` با سیاست deny-by-default؛
- migration/upcaster برای stateهای ماندگار قدیمی.

قواعد Engine:

- pure TypeScript و بدون I/O باشد؛ وابستگی runtime به NestJS، Prisma، Redis، Socket.IO یا Telegram SDK ممنوع است.
- زمان، تصادف و rule config را به‌صورت dependency صریح (`Clock`، `RandomSource`، `RuleConfig`) دریافت کند؛ `Date.now()` و `Math.random()` را مستقیم صدا نزند.
- shuffle/draw سمت سرور با CSPRNG انجام شود و seed، deck، card یا hidden state لاگ نشود.
- client فقط intent/command می‌فرستد؛ authority و محاسبهٔ outcome کاملاً سمت سرور است.
- ورودی command را validate کرده و state transition را deterministic و replayable نگه دارد.
- interface اصلی حول `createInitialState`، `validateCommand`، `execute`، `applyEvent`، `getPlayerView`، `getResult` و در صورت نیاز `migrateState` شکل می‌گیرد.
- frontend فقط `PlayerView` را render می‌کند و مرجع rule نیست.
- Bot دقیقاً همان `PlayerView` بازیکن انسانی را می‌گیرد، نه internal state. سیاست MVP آن rule-based/deterministic یا احتمالی محدود است، نه LLM.

هر Match باید `engine_version`، `state_schema_version` و `ruleset_version` را pin کند. deploy جدید نباید رفتار Match فعال را بی‌صدا تغییر دهد.

## 6. داده، تراکنش و سازگاری

- PostgreSQL منبع حقیقت durable است. Redis فقط برای presence، matchmaking، rate limit، cache و queue coordination است و از دست‌رفتن آن نباید Match ثبت‌شده را از بین ببرد.
- state جاری Match در `matches.state_jsonb` همراه `state_version` نگه‌داری می‌شود؛ `game_events` لاگ append-only برای audit/reconnect/replay است. این طراحی full Event Sourcing نیست.
- تغییر state و درج event باید در یک تراکنش atomic انجام شود.
- برای هر Match یک writer منطقی داشته باشید: row را lock کنید، `expectedVersion` و `actionId` را بررسی کنید، engine را اجرا کنید، state/events/processed command/outbox را در همان تراکنش بنویسید و سپس publish کنید.
- هیچ network I/O داخل تراکنش DB انجام ندهید؛ تراکنش کوتاه و retry محدود باشد.
- فرمان Match با `actionId` و `expectedVersion` idempotent است. mutationهای REST نیز `Idempotency-Key` یا `commandId` پایدار دارند؛ retry با همان شناسه باید همان نتیجهٔ منطقی را برگرداند.
- uniqueness پردازش فرمان Match روی `(match_id, action_id)` حفظ شود.
- Outbox و delivery رویدادها at-least-once هستند؛ consumer با `eventId` deduplicate و jobهای worker idempotent باشند.
- migration پایگاه‌داده backward-compatible و با الگوی `expand → migrate/backfill → contract` انجام شود. destructive migration را هم‌زمان با deploy کد انجام ندهید و حداقل یک release overlap حفظ کنید.
- payload jobها نسخه‌دار باشد و handler قدیمی تا تخلیهٔ queue باقی بماند.

## 7. REST، Socket و قراردادها

- endpointهای محصول زیر namespace `/v1` هستند.
- REST برای Auth، Profile، Game Catalog، Leaderboard و create/read اتاق است.
- Socket برای تغییر عضویت اتاق، matchmaking، command/event بازی، presence و chat است.
- هویت Socket در handshake از session/token معتبر استخراج می‌شود؛ هرگز `userId` داخل payload را مبنای هویت قرار ندهید.
- envelope فرمان بازی شامل `schemaVersion`، `actionId`، `matchId`، `expectedVersion` و `command` است.
- error code پایدار و machine-readable برگردانید؛ client نباید بر متن پیام خطا شرط بگذارد.
- رویدادهای realtime و schemaها نسخه‌دار و تغییرات آن‌ها additive باشند. breaking change فقط با namespace/version جدید، مسیر سازگاری و ADR مجاز است.
- OpenAPI و event catalog باید در CI تولید و diff شوند؛ breaking diff بدون version bump و ADR مجاز نیست.

تحویل server-to-player at-least-once است و هر رویداد Match `seq` افزایشی دارد. client باید duplicate را حذف، gap را تشخیص و snapshot/events جدید درخواست کند. reconnect snapshot حداقل `stateVersion` و `lastEventSeq` دارد و فقط state جدیدتر پذیرفته می‌شود.

## 8. Room، Matchmaking و Reconnect

- چرخهٔ Room: `WAITING → FULL → STARTING → STARTED → CLOSED`؛ اتاق می‌تواند expire شود و خروج پیش از شروع `FULL → WAITING` ایجاد کند.
- فقط host مجاز به start است؛ ظرفیت/وضعیت باید server-side کنترل شود. با خروج host، قدیمی‌ترین عضو باقی‌مانده host می‌شود. join باید idempotent باشد.
- invite code تصادفی، opaque و غیرقابل حدس باشد. deep link از الگوی `https://t.me/<bot>/<app>?startapp=room_<opaqueInviteCode>` پیروی می‌کند.
- Matchmaking بر اساس game/mode/capacity صف‌بندی می‌شود و هر کاربر برای هر game/mode فقط یک ticket فعال دارد. enqueue/cancel atomic باشد.
- Match فقط پس از رزرو TTLدار و commit رکوردهای PostgreSQL پیدا‌شده اعلام شود؛ admission token کوتاه‌عمر باشد. رقابت cancel-vs-match باید atomic باشد و فقط یک طرف برنده شود.
- چرخهٔ Match: `CREATED → WAITING_FOR_PLAYERS → READY → STARTING → ACTIVE → FINISHED` یا `TERMINATED`.
- reconnect دارای grace period و timeout job تأخیری BullMQ است. هر اتصال `connection_epoch` دارد و timeout باید `expectedConnectionEpoch` و `expectedStateVersion` را guard کند.
- پس از commit شدن `REPLACED_BY_BOT` در MVP، کاربر تا پایان Match فقط `SpectatorView` می‌گیرد.

## 9. امنیت و حریم خصوصی

- Telegram `initData` خام را server-side از نظر signature و freshness/`auth_date` اعتبارسنجی و مقایسهٔ signature را constant-time کنید. به `initDataUnsafe` یا Telegram ID ارسالی client اعتماد نکنید.
- access token کوتاه‌عمر و فقط memory-only است؛ آن را در `localStorage` قرار ندهید.
- راهبرد refresh token هنوز تصمیم باز است. در صورت تصویب، باید rotating و در cookie با `HttpOnly` و `Secure` باشد؛ در غیر این صورت re-auth از `initData` معتبر انجام می‌شود.
- `initData` خام، token و hash احراز هویت و bot token را persist یا log نکنید. تصمیم session/refresh همچنان باز است.
- snapshot و eventهای لازم برای state/replay بازی، شامل اطلاعات مخفی ضروری، فقط در storage مجاز معماری و با دسترسی محدود Match service ماندگار شوند. تاریخچهٔ chat در PostgreSQL با کنترل عضویت مجاز است؛ سیاست نهایی retention همچنان تصمیم باز است. این مجوز شامل نگه‌داری مستقل seed یا RNG material غیرضروری نیست.
- deck/card، RNG material، chat text و hidden state هرگز وارد log، trace یا error report نشوند؛ logging فقط با allowlist field انجام شود. persistence مجاز application را با telemetry اشتباه نگیرید.
- webhook بات باید HTTPS، `secret_token` header، rate limit و dedupe بر اساس `update_id` داشته باشد.
- auth/session، membership، role، state، capacity، turn و تمام قوانین بازی server-side enforce شوند.
- DTO/schema همهٔ ورودی‌های REST و Socket validate شود و rate limit توزیع‌شده بر Redis اعمال شود.
- `PlayerView` و `SpectatorView` نباید اطلاعات پنهان بازیکنان دیگر را افشا کنند.
- CORS فقط originهای شناخته‌شده، CSP محدودکننده، HTTPS/WSS، HSTS و security headerها را حفظ کنید.
- PostgreSQL و Redis public نباشند؛ API و Worker credentialهای جدا و least-privilege داشته باشند. secret را فقط از سازوکار امن محیط بگیرید.
- Admin نیازمند auth جدا، RBAC، MFA، محدودسازی شبکه/allowlist و audit append-only است.
- chat باید escape/sanitize، محدودیت طول و نرخ، کنترل membership و pagination داشته باشد.
- dependency، secret، lockfile و container scanning بخشی از CI است.

## 10. لاگ، tracing و عملیات

لاگ Pino ساخت‌یافته باشد و بر حسب مورد از فیلدهای استاندارد هم‌بستگی زیر استفاده کند:

`requestId`, `userId`, `roomId`, `matchId`, `actionId`, `event`, `stateVersion`, `durationMs`, `errorCode`

افزودن هر فیلد دیگر باید از allowlist لاگ پروژه پیروی کند. trace context باید در مسیر `REST/Socket → transaction → outbox → worker` منتقل شود. خطاهای قابل انتظار با error code ثبت شوند؛ اطلاعات پنهان یا payload حساس را برای debugging هم لاگ نکنید.

تغییرات عملیاتی باید runbookهای exploit/maintenance، افت DB، unavailable شدن Redis، Match گیرکرده و rollback deploy را نقض نکنند. در افت Redis، حضور و matchmaking می‌توانند degrade شوند، اما durable match data نباید از دست برود.

## 11. دستورات اجرا، build و تست

سند معماری نام دقیق scriptهای `package.json` را تعیین نکرده است. بنابراین **هیچ command یا نام script را حدس نزنید**.

پیش از اجرا:

1. manifest ریشه و package مربوط را بخوانید.
2. تنظیمات pnpm Workspace و Turborepo موجود در مخزن را بررسی کنید.
3. script اعلام‌شدهٔ همان مخزن را اجرا کنید؛ برای تغییر محدود، ابتدا کم‌دامنه‌ترین workspace/package مرتبط را هدف بگیرید.

معادل‌های تعریف‌شده در مخزن برای این مراحل باید استفاده شوند:

1. نصب با frozen lockfile؛
2. lint؛
3. typecheck؛
4. unit/domain tests؛
5. integration tests؛
6. build؛
7. E2E smoke در staging، هرجا environment آن فراهم است.

اگر script لازم در manifest وجود ندارد، آن را به‌عنوان شکاف گزارش کنید؛ command ساختگی به راهنما یا CI اضافه نکنید. conventionهای formatting، lint و TypeScript را از تنظیمات مرکزی `tooling/eslint` و `tooling/typescript` و کد مجاور بگیرید؛ سند convention نحوی دیگری تعیین نکرده است.

## 12. راهبرد تست

هر تغییر باید متناسب با ریسک خود تست شود:

| نوع تغییر | حداقل پوشش مرتبط |
|---|---|
| rule/state transition در Coup | Vitest unit/domain، invariant و deterministic replay |
| repository/transaction/outbox | Integration و idempotency |
| REST یا Socket contract | schema/contract test و compatibility diff |
| Room/Matchmaking/Reconnect | Integration، race و timeout tests |
| PlayerView/SpectatorView | information-flow و golden tests برای عدم نشت اطلاعات |
| مسیر اصلی محصول | Playwright E2E: create → join → start → play → finish |

سناریوهای concurrency مهم شامل cancel-vs-match، فرمان تکراری و reconnect-vs-timeout هستند. برای engine از property/model/replay tests استفاده کنید. تغییرات زیرساختی مرتبط باید failureهای DB/Redis، retry worker و node drain را نیز پوشش دهند.

برای آمادگی launch، load test با ۲ برابر peak هدف، reconnect storm و soak حداقل دوساعته لازم است؛ مقدار peak هنوز یک تصمیم باز است و نباید حدس زده شود.

## 13. معیار اتمام تغییر

پیش از تحویل، موارد مرتبط را کنترل کنید:

- مرز ماژول و importها حفظ شده‌اند و business rule به adapter/shared نشت نکرده است.
- command/event/API تغییرکرده schema و version مناسب دارد و compatibility آن بررسی شده است.
- write pathهای Match atomic، version-checked و idempotent هستند؛ publish پس از commit انجام می‌شود.
- replay با state/version مربوط deterministic است.
- PlayerView/SpectatorView و logها هیچ secret یا hidden state افشا نمی‌کنند.
- migration یا job payload جدید مسیر سازگاری نسخهٔ قبل را دارد.
- تست‌های unit، integration، contract، build و E2E مرتبط با scriptهای واقعی مخزن اجرا شده‌اند؛ موارد اجرا‌نشده و علت آن‌ها گزارش شده است.
- مستندات معماری/قرارداد برای رفتار جدید به‌روز شده‌اند.

برای Game Module جدید، علاوه بر موارد بالا، manifest، version descriptor، pure engine، viewهای امن، timer/reconnect policy، result mapper، migration/upcaster، frontend adapter، bot policy و تست‌های deterministic/property/contract الزامی‌اند.

## 14. ADR و تصمیم‌های باز

تصمیمی که implementation را محدود، قرارداد public را break یا اصل معماری را تغییر می‌دهد باید ADR داشته باشد: `Status`، `Context`، `Decision`، `Alternatives`، `Consequences`، `Owner`، `Date` و در صورت نیاز `Supersedes`.

این تصمیم‌ها در سند هنوز باز هستند؛ آن‌ها را بی‌صدا نهایی یا hard-code نکنید:

- peak CCU، تعداد Match فعال و command/sec؛
- host و region نهایی؛
- strategy نهایی session/refresh token؛
- امکان reclaim صندلی پس از Bot takeover؛
- retention/report/mute و سیاست سنی chat؛
- PITR، RPO و backup retention؛
- تأیید نهایی SLOها؛
- حقوق نام، rule text و assetهای Coup.

اگر یک task به یکی از این موارد وابسته است، فرض را آشکار کنید و پیش از تثبیت رفتار عمومی، تصمیم را در ADR یا مرجع تصمیم پروژه ثبت کنید.

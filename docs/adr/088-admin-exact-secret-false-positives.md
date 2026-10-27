# ADR-088 — طبقه‌بندی دقیق سه تشخیص اشتباه Secret Scan فاز دوم

- **Status:** Accepted؛ مالک صریحاً «تأیید فقط همین سه مورد با تطبیق دقیق شواهد» را در همین گفتگو اعلام کرد. صرفاً تغییر محلیِ طبقه‌بندی؛ بدون مجوز استقرار.
- **Owner:** مالک HamBazi
- **Date:** 2026-10-27
- **Supersedes:** فقط لزوم تصمیم جدید ADR-068 برای سه finding مشخص زیر برآورده می‌شود؛ هیچ کنترل یا استثنای قبلی جایگزین/گسترده نمی‌شود.

## Context

بررسی فاز دوم، دو مقدار ساختگی در تست‌های تاریخی و یک شناسهٔ عمومی Git در provenance قدیمی را پیدا کرد. ADR-068 برای هر location/source جدید تصمیم صریح می‌خواست. مالک فقط همان سه مورد مستندشده را پذیرفت؛ این پذیرش مجوز معاف‌کردن کل تست، فایل یا commit، تغییر detector، بازنویسی تاریخچه یا پذیرش secret واقعی نیست.

## Decision

descriptor اجرایی [gitleaks-admin-phase2-exceptions.json](../../infra/security/gitleaks-admin-phase2-exceptions.json) و [رسید بررسی](../security/admin-phase2-secret-review.json) دقیقاً همان سه finding مصوب را ثبت می‌کنند:

| مورد                         | context مصوب                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| مقدار ساختگی تست امنیت Admin | `apps/api/tests/admin/security.test.ts`، commit کامل `a24ce45335db039dc94c654dedd916470893fdac`، خط 119، ستون 10–56؛ فقط history                                                                                                         |
| مقدار ساختگی تست ingress     | `apps/api/tests/ingress/admin-public.test.ts`، همان commit، خط 323، ستون 14–60؛ فقط history                                                                                                                                              |
| شناسهٔ commit عمومی          | `infra/docker/staging/staging-test-user-current.json`، commit کامل `bbf8238dc3d3436439e1829bdb3b954e8a684fbd`، خط 1967، ستون 9–56، فیلد `previousContinuousApplication.roleSourceCommits.api`؛ history و فقط همان blob مصوب در candidate |

هر تطبیق به rule دقیق، path، commit تاریخچه، ابتدا/انتهای خط و ستون، Secret/Match کاملاً redacted، نبود symlink، SHA-256 کل سورس و SHA-256 خط متصل است. مقدار public provenance از همان ancestry در JSON خوانده و وجود واقعی آن به‌عنوان Git commit بررسی می‌شود؛ arbitrary hash معاف نیست. دو literal تاریخی هرگز برای candidate معاف نمی‌شوند. جابه‌جایی ستون، حتی شکل first-diff-line پذیرفته‌شدهٔ استثنای قدیمی، برای این سه مورد مجاز نیست مگر دقیقاً در شواهد جدید تصویب شود.

Gitleaks 8.30.1 همچنان همهٔ این موارد را detect می‌کند و exit/report خام ابتدا اعتبارسنجی می‌شوند. runner تنها بعد از اثبات تمام قیود بالا آن‌ها را در `reviewedFalsePositives` می‌شمارد؛ detected و blocking جدا گزارش می‌شوند. native exit 1 با finding مصوب پنهان نمی‌شود. هر finding دیگر مسدودکننده است؛ خطای context، ابزار یا evidence موفقیت تلقی نمی‌شود.

detectorهای پیش‌فرض، scan همهٔ refهای reachable محلی و candidateهای tracked/nonignored، منع shallow history، hash ابزار، ignore خالی، رد inline allow، redaction، پاک‌سازی گزارش و exception مصوب ADR-068 بدون تغییر باقی‌اند. فایل provenance یا محتوای تاریخچه برای مخفی‌کردن finding دست‌کاری نمی‌شوند. هیچ fingerprint baseline یا regex عمومی برای تست/فایل/commit اضافه نمی‌شود.

## Alternatives

معافیت سراسری تست‌ها، allowlist کل فایل/commit، پذیرش هر hash یا API field، تغییر detector، حذف provenance و بازنویسی تاریخچه رد شدند. باقی‌ماندن gate بسته پس از پذیرش صریح نیز ضروری نیست؛ فقط همان context تأییدشده قابل طبقه‌بندی است.

## Consequences

تست‌ها اصل هر سه blob تاریخی، حالت candidate دو تست ممنوع و provenance مجاز، drift تک‌تک metadataها، تغییر سورس/ancestry و symlink را می‌سنجند. native scanner باید چهار detection تاریخی (یک مورد ADR-068 و سه مورد این تصمیم) و یک detection در candidate بدون blocking نشان دهد. credential تولیدشدهٔ واقعی در همین فایل و credential صرفاً تاریخی همچنان باید مسدود شوند. گزارش خام یا credential وارد artifact عمومی نمی‌شود.

این تصمیم فقط مانع Secret Scan را هدف می‌گیرد. یافته‌های HIGH/UNKNOWN ایمیج‌های محلی، build/scan/Qualification ایمیج نهایی و پذیرش عملکرد همچنان gateهای مستقل‌اند. Staging، Production، OWNER و فاز سوم خارج از مجوز هستند. هر finding یا تغییر context جدید دوباره نیازمند بررسی و تصمیم مستقل است.

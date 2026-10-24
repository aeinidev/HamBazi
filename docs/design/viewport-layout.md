# Original page layouts restored — 2026-10-24

At the owner’s request, the compact viewport experiment from 2026-10-23 has been
removed from every screen. Existing responsive page styles again determine the
layout and natural scrolling. Settings/profile use their original form arrangement;
Coup entry and tutorial retain their original artwork and continuous reading;
Kahroba lobby, room forms, rosters and dialogs use their previous proportions.
The Kahroba table presents the market, nobles, token bank, purchase assistant and
player resources together. Collection and reservation lists are continuous again.

The shared viewport overrides, tutorial pagination and market/resources tabs have
been removed. Existing native Telegram presentation and safe-area handling remain.
The current fantasy main-lobby design is preserved. Image optimization, hashed
WebP assets, responsive sources, compression and static cache validators remain.
No rules, server authority, contracts, dependencies or database schemas change.

Existing Midnight navigation/tutorial/native-presentation and Kahroba lobby/table
browser suites verify the restored behavior in Chromium and WebKit. They retain
horizontal overflow, accessibility, game action and image-decoding checks, without
requiring every page to fit one screen vertically.

Publication and actual HTTPS verification are recorded in
[the deployment record](../operations/layout-restoration-deployment-20261024.md).

The subsequent [content-aware layout](natural-page-layout.md) adapts short pages
to available height, preserves scrolling for additional content and explicitly
excludes the Kahroba game. It does not restore the earlier pagination or table tabs.

# Profile Hub implementation

The requested screen uses the existing home font, navy canvas, cyan/violet light,
rounded cards and bottom navigation. A pinned identity card includes the live draft
avatar/name, chosen username and four real all-time counters. The scrollable body
contains account fields, both five-avatar groups and compact per-game statistics.
Save and secondary logout remain reachable above the bottom dock. No mock counters.

Implementation sequence: cover profile validation and authenticated availability;
add durable fields, transaction checks and compatible receipts; optimize supplied
assets; implement the editor, circular crop, draft/leave protection and lobby avatar;
verify HTTP/DB concurrency, browser editing, keyboard/accessibility and responsive
layout in Chromium/WebKit. Reuse existing settings editor and statistics endpoint.

Acceptance: selection is unrestricted, upload checks 3 MiB/type, crop precedes save,
availability ignores stale replies, network retries keep command IDs, conflicts keep
the draft until explicit reload, and navigation/logout warn before discarding it.

Mobile editing uses the visible browser/Telegram viewport: the bottom dock hides
only when a soft keyboard reduces the profile viewport, the focused account field
stays visible, and the previous scroll/frame returns after dismissal. Inputs use
at least 16px text to avoid iOS focus zoom; desktop hardware focus keeps the dock.

The native modal crop editor locks background scrolling and uses one-finger pan
and two-finger pinch with bounded source coordinates. Its circular preview and
saved image use the same canvas. There are no sliders; keyboard arrows and +/-
remain available. Native Back cancels the crop before navigating away; cancellation
preserves account drafts and returns focus to upload.

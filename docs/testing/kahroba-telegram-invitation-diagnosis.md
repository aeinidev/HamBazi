# Kahroba Telegram invitation fix — 2026-10-19

Status: corrected and verified locally with isolated signed accounts. Production remains on HOLD. No push, deployment, admission change, migration, Bot change or staging service operation was performed. Native Telegram acceptance and the current server audit remain pending SSH access.

## Root cause and deployed evidence

Recorded staging API/Worker/Web revision: `271ee6e282ab1622dd97261912f0619d2fc7a052`, with the existing retained Bot. HTTPS retrieved the actual served `/assets/index-CZ5tuFdI.js`, SHA-256 `84f2268343609d69dc8793e39bbd43909370f45ac590975b45a5863aa9995c70`. The entry document and JavaScript both return `Cache-Control: no-store`.

Two launch defects are confirmed:

1. Bootstrap removes `tgWebApp*` URL fields, but Main extracts its Kahroba hint only from credential `start_param`. Separate query/fragment `tgWebAppStartParam` is discarded before routing. Executing the exact served bundle with intercepted synthetic responses reproduced the normal-lobby/no-preview result for query-only hints; the credential `start_param` control reached its preview.
2. Main initializes only once. Once the URL is scrubbed, opening another Telegram fragment link can be same-document navigation. The app retains its previous launch and ignores the new invitation/credential. The actual Web/API/Worker WebKit regression failed at this entry before relaunch handling was added. The earlier successful cached-route control used a credential navigation and did not exercise this case.

The UI also chose its invitation label using `joinEnabled`. An invitation could appear as “ورود با کد” while preview or Socket checks were pending, obscuring detection independently of authorization.

The source was initially unavailable in the old `bbf8238…` checkout. After the owner's retry, the deployed commit became available and the checkout included merged playable-lobby base `70515e4…`. The correction preserves that newer lobby and its existing Ready → explicit host Start behavior. Strict-host-key, noninteractive SSH still returns `Permission denied (publickey,password)`; the agent has no identities. Live labels, logs and the reported native launch were not inspected. The defects are reproduced; the precise trigger during the owner's original attempt is not claimed as observed.

## Corrected flow and authority

The server still issues an opaque Main/named Mini App invitation. Before URL cleanup, bootstrap captures the hint independently of the raw authentication credential. Current URL credential `start_param` wins, then query/fragment `tgWebAppStartParam`, then SDK hints when no current URL credential is supplied. Current URL credentials replace stale SDK bytes unchanged. Duplicate, empty or malformed current hints do not restore a cached invitation.

The reviewed SDK, integrity pin and storage guard remain in use. Bridge/credential initialization for a pending invitation retains the ten-second startup deadline; failure/late completion grant no credential. No browser credential cache is introduced.

Main handles fresh launch fields on hash/history navigation and SDK activation. Hint-only navigation can retain its existing live session. New or changed credentials dispose old parent/child runtimes and must pass the real verifier again; forged credentials cannot borrow the old token. Normal game navigation does not reauthenticate. An invitation selects its invite route even if Telegram retained another Kahroba route.

The lobby shows **پیوستن با دعوت** immediately for a canonical invitation. The action remains disabled until authenticated preview, expiry/game checks and Socket connection pass. Resolution and `room:join` retain the server-issued opaque code, resolved room ID/version, server session identity and existing authorization. There is no automatic join or widened admission. SDK unsafe fields are routing hints only.

Telegram documents both representations in its [direct-link Mini App documentation](https://core.telegram.org/bots/webapps#direct-link-mini-apps). Neither representation replaces signed identity or membership verification.

## Verification

| Check                                                       | Result                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen-lockfile install                                     | Passed; dependencies/lockfile unchanged.                                                                                                                                                                                                                                                              |
| Regressions against original implementation                 | Seven failed before correction: lost hints, stale SDK credentials and delayed initialization.                                                                                                                                                                                                         |
| Web unit suite                                              | 123 passed, including query/fragment capture, exact credential bytes, malformed/duplicate hints, privacy failure, delayed initialization and disabled invitation affordance.                                                                                                                          |
| Auth verifier and invite unit suites                        | 125 passed.                                                                                                                                                                                                                                                                                           |
| Built-app Telegram privacy with exact SRI-verified SDK      | 11 passed after final relaunch changes: cache cleanup, logout, unavailable storage, changed/failed SDK and query launch remain protected.                                                                                                                                                             |
| Actual Web/API/Worker browser regressions                   | Chromium and WebKit passed using separate browser contexts, registered synthetic Telegram identities, real HMAC verification and disposable PostgreSQL/Redis.                                                                                                                                         |
| Two-player path                                             | Create → server invite/share → same-document hint-only re-entry without login → disabled invitation while preview waits → forged relaunch rejected with 401 → signed query/fragment entry → correct-room join → both Ready → host-only Start → gameplay → reconnect/API restart → results/statistics. |
| Completion                                                  | Chromium: 62 turns. WebKit: 54 turns. Private reservations, duplicate commands, admission-off active-match continuation, zero credential storage and durable v2 completion passed.                                                                                                                    |
| Database foundation / Worker Kahroba                        | 17 / 3 passed. Earlier unchanged 3/4-player and shared-result cases passed; the focused final run skipped those three to avoid repeating them.                                                                                                                                                        |
| Web typecheck, lint, architecture boundaries, API contracts | Passed. No public contract, event, schema version or baseline changed.                                                                                                                                                                                                                                |

The initial full runtime run exposed the same-document WebKit failure. An intermediate browser run overlapped source edits and was discarded. The final unchanged-source run passed both browsers; its evidence is separate. The first privacy attempt lacked a matching downloaded SDK fixture; using the repository's reviewed bytes passed without changing SDK/SRI policy.

Evidence: ignored `test-results/kahroba-invitation/`, including deployed bundle/headers and controls, `unit-before.log`, `web-unit.log`, `auth-invites.log`, `telegram-privacy-final.log`, `runtime-final.log` and `runtime-final/{chromium,webkit}-runtime-e2e.json`. Screenshots use disposable accounts. The harness's `--runtime-browser-only` option selects affected browser cases while retaining fresh-service setup and Worker validation.

## Release preparation and remaining gate

This correction changes frontend launch handling and the invitation label. Engine/rules/assets, server authentication/authorization, Bot, durable storage, historical events and admission/containment configuration are unchanged. Retain the existing owner and `@devtest98` only. The supplied playable-lobby base is newer than recorded staging: its existing API/Worker requirements must accompany that base; a blind Web-only replacement of the older deployment is insufficient.

Bind the local candidate to exact source and private staging Web inputs/artifacts. Never label an uncommitted snapshot clean. Fresh exact-image security evidence and the existing preparation/rollback gates remain required before activation; this report grants no exception or deployment authority.

SSH remains the live verification blocker. Before final staging approval, read back images/health, safe relevant logs, admission, invitation target, data/history, containment and rollback compatibility. Then perform bounded native owner/tester acceptance on the approved candidate. No native acceptance, current server readback or production approval is inferred from local tests or historical bindings.

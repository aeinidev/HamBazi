# Temporary laptop server

The owner selected their own laptop for temporary development hosting.
[ADR-044](../adr/044-temporary-laptop-server.md) records this limited scope.
API, cleanup Worker, PostgreSQL, Redis and built Web are real services. Gameplay
is not enabled: the existing API entrypoint does not compose its realtime ports,
and secured game activation remains Phase 7C. Phase 17C remains Pending.

## Start, status and stop

From the repository root, use its declared scripts:

```sh
pnpm laptop:start
pnpm laptop:status
pnpm laptop:stop
```

Start launches a detached supervisor and may take several minutes on the first
build. Status reports STARTING, READY, DEGRADED, FAILED or STOPPED and includes
the current local/public URLs. READY requires healthy Web/API/Worker services
and a successful HTTPS request through the public tunnel. Do not treat the
initial tunnel allocation as readiness. After editing application code, stop
and start to rebuild it. Stop drains applications and stops this project's data
containers, preserving `hambazi-laptop_postgres-data`; it never deletes volumes.

The local address is `http://127.0.0.1:3100`. The public HTTPS URL is temporary;
read it from status after every start. The service uses localhost.run because
Cloudflare edge TLS timed out on the tested network. Free tunnel hostnames may
change/expire after a few hours. Restart if that happens. Keep the laptop awake
and connected. There is no boot-time service or automatic sleep-setting change.

Prerequisites are the manifest-pinned Node/pnpm, installed dependencies, Docker
and Compose, the existing locked local PostgreSQL/Redis images, SSH, curl and
netcat. The existing mode-0600 root `.env` must contain local data credentials and
`TELEGRAM_BOT_TOKEN`; the runner never prints it or embeds it in Web. The optional
HTTP(S) proxy environment must name an unauthenticated local HTTP proxy. These
commands need the user's ordinary Docker/network access; a restricted execution
sandbox cannot inspect or control the detached host process.

If startup fails, read the scalar `errorCode` from status and the supervisor's
content-free `.laptop-server/server.log`. Fix the named stage and start again.
Do not print database environments, inspect raw application payloads or delete
the volume to repair an error. `.laptop-server` contains private session material
and host keys, is ignored by Git and must remain private.

## Exposure and authentication

Only the product/Web ingress is tunneled. PostgreSQL/Redis, API/Web direct ports
and health/metrics listeners bind to loopback. Private Bot/admin/health endpoints
and hidden files return 404 through the ingress. API access remains authenticated
by the real Telegram signature/session checks; absent credentials return 401.
There is no synthetic browser fixture or sign-in bypass.

To use real Telegram sign-in, the current HTTPS URL must be opened by the user's
Telegram Mini App. This setup does not modify BotFather, webhook or menu settings.
The Web artifact has no approved frame ancestors, so native Telegram is the
initial supported launch context; Telegram Web embedding needs its own origin
configuration. Public forwarded client identities are discarded, so visitors
share the temporary IP quota. Configure a reviewed proxy policy before load
testing multiple independent visitors.

## Next work toward Phase 17C

This environment can support initial service/network checks and local workload
development. Full gameplay testing needs reviewed live composition/activation;
capacity acceptance additionally needs an approved workload/peak and SLOs.
Laptop/tunnel/network limits must be measured separately. No two-hour soak,
2x approved peak, reconnect storm or durable reconciliation is claimed here.

## Verification recorded on 2026-10-05

Frozen dependency installation, backend/Web builds, forward migrations/grants,
root lint, architecture checks, scoped formatting and whitespace checks passed.
The declared infrastructure suite passed 69 tests with one existing conditional
skip. Local and public probes verified Web 200, unauthenticated API 401 and 404
for private Bot, health, admin and `.env` paths. Public responses served the real
Web artifact/JavaScript with CSP, HSTS and no-store headers. A stop/start rehearsal
retained the same database volume and restored healthy API/Worker/Web with a new
verified public hostname. Browser UI/Telegram smoke was not run because no
connected browser was available; no full gameplay or Phase 17C evidence is claimed.

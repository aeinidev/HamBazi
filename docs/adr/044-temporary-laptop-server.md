# ADR-044: Temporary laptop server for development

- **Status:** Accepted for the owner's temporary laptop-server request only
- **Owner:** HamBazi owner
- **Date:** 2026-10-05

## Context

The owner requested temporary free hosting, then explicitly selected their own
laptop as the server. Docker, the reviewed local database images, Node 24 and
pnpm are available. The existing API entrypoint exposes authentication, profile
and catalog; it does not compose realtime gameplay. Phase 7C and Phase 17C remain
Pending. This request supersedes the earlier deferral of execution only for this
limited development environment, without approving production operating policies.

## Decision

Run host processes for the real API, cleanup Worker and built Web application,
supervised by `infra/scripts/laptop-server.mjs`. The frontend uses a strict
production browser-policy artifact; backend services retain the development
profile for local data transport. Forward a single loopback HTTP ingress through
a free localhost.run SSH tunnel. The initial Cloudflare attempt allocated a URL
but its edge TLS handshake timed out on this internet connection, so it was not
accepted as working public hosting.

Use a dedicated Compose project and durable volume, `hambazi-laptop` and
`hambazi-laptop_postgres-data`. The laptop override explicitly supplies the
PostgreSQL image's `postgres` command because overriding its entrypoint clears
the image CMD in Compose. Use a normal bridge for host port publication; both
data ports remain bound to loopback. The base local/release definitions are
unchanged. Run only the declared forward migration/grant command, with migrator
credentials excluded from application processes.

The supervisor reads the existing private `.env`, requires local data URLs and a
configured Bot token, and supplies role-specific environment objects. API and
Worker retain their separate credentials. Signing material is generated once in
the ignored mode-0700 `.laptop-server` directory, with mode-0600 files. No synthetic
identity, auth bypass, refresh strategy or catalog activation is added. The Bot
token is used for server-side initData verification; no Telegram webhook, menu,
message or BotFather setting is changed.

The ingress has no access logging and excludes internal Bot, admin, health,
metrics, dotfiles and traversal paths. It forwards only existing product REST
namespaces and immutable Web assets. Socket upgrades remain unavailable because
the runtime does not compose gameplay. Client-supplied forwarded identity is
discarded. Public requests share the loopback admission IP, a conservative
temporary limit; this is not a production trusted-proxy policy. Explicit small
development quotas/pools in the supervisor are setup values, not OD-001 capacity
targets or OD-007 SLO approval.

SSH uses no private identity or agent, retains a project-local known-hosts file
with initial trust-on-first-use and subsequent key checking, and can use an
already configured unauthenticated local HTTP proxy through installed netcat.
It changes no system proxy, router, firewall or boot configuration. Readiness
requires all three local health checks and an actual public HTTPS 200 response.
Application/tunnel exit stops ingress and other processes. Stopping retains the
database volume; starting reapplies compatible migrations and rebuilds the Web
policy for the newly allocated hostname.

## Alternatives

- Cloudflare Quick Tunnel: tested but unreachable through the current edge route.
- Render Free: lacks the required free Worker/private ingress capabilities.
- A managed VM: requires an account/access and an approved operating scope.
- A browser fixture: cannot exercise real durable API/Worker behavior.

## Consequences

The laptop must stay awake, connected and running. Tunnel domains can expire or
change; restart and retrieve the new URL rather than reusing stale origins.
Native Telegram authentication still needs a launch from the user's Bot/Mini App;
opening the URL in an ordinary browser does not supply signed initData. Telegram
Web framing is denied until actual embedding origins are explicitly configured.

This provides a temporary real-service development baseline. It does not claim
production-like staging, full MVP gameplay, backup/PITR, approved peak/region/SLO,
reconnect-storm or two-hour soak evidence. Final OD-001/002/006/007 and Phases
7C/17C/18B3/19 remain unresolved for their existing release scope.

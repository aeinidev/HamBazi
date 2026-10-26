# Private Admin deployment

This directory belongs to the explicit SSH-only phase-one deployment in ADR-082.
The reviewed operator report and connection instructions are in
[`docs/implementation/admin-private-deployment-2026-10-26.md`](../../../docs/implementation/admin-private-deployment-2026-10-26.md).

`Dockerfile` consumes a frozen production pnpm deployment in `api/`, the built
Admin bundle in `client/`, and `healthcheck.mjs`. The approved runtime must be
immutable; its complete `/app` is replaced. Building this image does not enroll
an OWNER or deploy any player application. Provisioning secrets are never build
arguments or part of the context.

The running instance uses an exact image ID, a separate private IP, no published
ports, separate PostgreSQL roles and a namespace-limited Redis ACL. Existing
databases with revoked PUBLIC CONNECT require an explicit CONNECT grant to the
new roles in addition to `admin-permissions.sql`. The runtime does not receive
bootstrap/recovery credentials, ownership proof keys, or the CA signing key.

The service requires reviewed root-private control/state files before admission.
The controller binds the actual Docker daemon, container, image, files and fresh
scan evidence, with expiry bounded by the core infrastructure deadline. The
container uses Docker restart policy `no`; systemd owns its lifecycle. The
expiry timer is generated from genuine advisory timestamps, never from a
fabricated future date. The renewal timer refreshes evidence but cannot reopen
a contained instance. A durable maintenance marker blocks start and serves 503.

For rollback use the private controller's `--contain` on the host. Do not remove
shared data volumes, down-migrate the schema, or restart player services as an
Admin-only rollback. Reopening requires explicit operator qualification and
marker removal. A certificate renewal timer does not by itself prove working
CA connectivity; see the report's remaining renewal prerequisite.

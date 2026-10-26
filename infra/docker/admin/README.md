# Private Admin deployment

The installed SSH-only deployment is recorded in ADR-082. The new candidate
`public-https.conf` follows ADR-083: public browser HTTPS, a private TLS backend,
and private SSH-only Bootstrap/Recovery. The separately approved Staging rollout
is tracked in the [Public HTTPS deployment report](../../../docs/operations/admin-public-https-staging-20261027.md).
Read the [candidate report](../../../docs/implementation/admin-public-https-preparation-2026-10-26.md)
before any separately approved rollout. No firewall, server or account changes
are implied by these files.
The reviewed operator report and connection instructions are in
[`docs/implementation/admin-private-deployment-2026-10-26.md`](../../../docs/implementation/admin-private-deployment-2026-10-26.md).

`Dockerfile` consumes a frozen production pnpm deployment in `api/`, the built
Admin bundle in `client/`, and `healthcheck.mjs`. The approved runtime must be
immutable; its complete `/app` is replaced. Building this image does not enroll
an OWNER or deploy any player application. Provisioning secrets are never build
arguments or part of the context.

Before building from a root-private transported archive, normalize only the
non-secret `api/` and `client/` trees: directories must be traversable and files
readable by UID 1000, preserving executable bits and removing group/other write.
Keep the outer release directory private. Smoke Argon2 as UID 1000 in the exact
image before admission; a successful root-only import is insufficient.

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

The public profile additionally requires the Admin-only Certbot hook, verified
live certificate/receipt and a control `ingressMode` matching the runtime env.
The explicit public admission marker defaults to absent. A successful local
hook test is not evidence of working server egress or actual Certbot renewal.
Reuse the host timer only after its real dry run and deploy hook pass without
the operator workstation. Do not enable public admission to troubleshoot renewal.

`test-image.json` pins a publicly pullable Nginx fixture solely for disposable
loopback tests and CI. It is not an approved deployment image or a production
vulnerability-scan result. The actual deployment uses the host's qualified
Nginx installation and the separately scanned Admin application image.

For rollback use the private controller's `--contain` on the host. Do not remove
shared data volumes, down-migrate the schema, or restart player services as an
Admin-only rollback. Reopening requires explicit operator qualification and
marker removal. A certificate renewal timer does not by itself prove working
CA connectivity; see the report's remaining renewal prerequisite.

The Staging owner ceremony now follows [ADR-084](../../../docs/adr/084-staging-owner-private-ssh-ceremony.md) and the [private runbook](../../../docs/operations/admin-owner-staging-ceremony.md). Its root/SSH/TTY policy, checkpoint, current-owner-password recovery and encrypted off-server restore receipt are separate from the runtime container. The dedicated Staging grant file is not part of ordinary migration grants. The approved private installation, host runtime/client qualification and remaining backup/account gates are recorded in the [installation report](../../../docs/implementation/admin-private-owner-installation-2026-10-26.md). OWNER has no forgot/reset-password flow.

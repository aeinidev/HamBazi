#!/usr/bin/env bash
set -euo pipefail

# Runner provisioning only. Existing local/staging services are never configured.
if [[ "${CI:-}" != "true" || "${RUNNER_OS:-}" != "Linux" || -z "${RUNNER_TEMP:-}" ]]; then
  echo "CI_POSTGRES_PROVISIONING_REQUIRES_EPHEMERAL_RUNNER" >&2
  exit 1
fi
if [[ "$(dpkg --print-architecture)" != "amd64" ]] || ! grep -qx 'VERSION_CODENAME=noble' /etc/os-release; then
  echo "CI_POSTGRES_PROVISIONING_REQUIRES_UBUNTU_24_04_AMD64" >&2
  exit 1
fi

# The official PGDG repository uses a dedicated key, rather than apt-key/global trust.
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
sudo tee /etc/apt/sources.list.d/hambazi-pgdg.sources >/dev/null <<'SOURCES'
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: noble-pgdg
Architectures: amd64
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
SOURCES
sudo apt-get update
sudo apt-get install --yes --no-install-recommends postgresql-18 postgresql-client-18
/usr/lib/postgresql/18/bin/psql --version

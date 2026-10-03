#!/bin/sh
set -eu

# Never start a libc/other-image cluster with different collation semantics.
# Preserve the existing volume; logical migration into a fresh volume is explicit.
if [ -s "${PGDATA:?Missing data path}/PG_VERSION" ]; then
  if [ "$(cat "$PGDATA/PG_VERSION")" != 18 ] \
    || [ ! -f "$PGDATA/.hambazi-image-policy" ] \
    || [ -L "$PGDATA/.hambazi-image-policy" ] \
    || [ "$(cat "$PGDATA/.hambazi-image-policy")" != 'postgres18-builtin-C.UTF-8-v1' ]; then
    printf '%s\n' 'POSTGRES_IMAGE_MIGRATION_REQUIRED: preserve this volume and follow the local image transition runbook.' >&2
    exit 78
  fi
fi
exec /usr/local/bin/docker-entrypoint.sh "$@"

#!/bin/sh
# The official entrypoint may source this file; isolate shell options.
(
set -eu
if ! policy=$(psql -X --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -At --set ON_ERROR_STOP=1 \
  -c "SELECT datlocprovider='b' AND datlocale='C.UTF-8' AND pg_encoding_to_char(encoding)='UTF8' FROM pg_database WHERE datname=current_database()" 2>/dev/null) \
  || [ "$policy" != t ]; then
  printf '%s\n' 'POSTGRES_IMAGE_POLICY_INVALID' >&2
  exit 1
fi
umask 077
printf '%s\n' 'postgres18-builtin-C.UTF-8-v1' > "$PGDATA/.hambazi-image-policy"
)

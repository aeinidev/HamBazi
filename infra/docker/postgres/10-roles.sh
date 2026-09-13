#!/bin/sh
# The official image may source this file; do not change its shell options.
(
set -eu

# psql variables quote passwords as SQL literals, without exposing them in argv.
psql -X --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_error_verbosity = 'terse';
\getenv api_password POSTGRES_API_PASSWORD
\getenv worker_password POSTGRES_WORKER_PASSWORD
\getenv migrator_password POSTGRES_MIGRATOR_PASSWORD
CREATE ROLE hambazi_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'api_password';
CREATE ROLE hambazi_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'worker_password';
CREATE ROLE hambazi_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'migrator_password';
REVOKE ALL ON DATABASE hambazi FROM PUBLIC;
GRANT CONNECT ON DATABASE hambazi TO hambazi_api, hambazi_worker, hambazi_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO hambazi_api, hambazi_worker;
GRANT USAGE, CREATE ON SCHEMA public TO hambazi_migrator;
-- Table/sequence permissions belong to the migrations that introduce them.
SQL
)

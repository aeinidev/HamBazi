#!/bin/sh
set -eu
umask 077

# Store password hashes, never cleartext ACL credentials or CLI password arguments.
api_hash=$(printf '%s' "${REDIS_API_PASSWORD:?Missing API credential}" | sha256sum)
worker_hash=$(printf '%s' "${REDIS_WORKER_PASSWORD:?Missing Worker credential}" | sha256sum)
health_hash=$(printf '%s' "${REDIS_HEALTH_PASSWORD:?Missing health credential}" | sha256sum)
printf 'user default off\nuser api on #%s ~hambazi:* &hambazi:* +@read +@write +@connection +@pubsub +@scripting -@dangerous +info\nuser worker on #%s ~hambazi:* &hambazi:* +@read +@write +@connection +@pubsub +@scripting -@dangerous +info\nuser health on #%s +ping\n' "${api_hash%% *}" "${worker_hash%% *}" "${health_hash%% *}" > /tmp/users.acl
unset REDIS_API_PASSWORD REDIS_WORKER_PASSWORD REDIS_HEALTH_PASSWORD api_hash worker_hash health_hash
exec redis-server --aclfile /tmp/users.acl --save '' --appendonly no --maxmemory-policy noeviction --protected-mode yes --bind 0.0.0.0

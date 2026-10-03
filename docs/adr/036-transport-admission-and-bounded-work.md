# ADR-036: Explicit distributed transport admission and bounded work

- Status: Accepted for Phase 17A2 implementation; production values remain owner-gated
- Owner: HamBazi engineering; deployment/capacity policy belongs to the product/operations owner
- Date: 2026-10-02
- Related: ADR-014, ADR-017, ADR-018, ADR-025, ADR-026, ADR-027, ADR-029, ADR-032

## Context

Phase 17A1 recorded SR-003/004: feature quotas and packet limits did not bound
unauthenticated HTTP/Engine.IO work or the serialized Socket work queue. The
owner authorized 17A2 after its mandatory gate. The architecture requires Redis
distributed admission, server-owned permissions, protected recipient views and
bounded work, while existing decisions preserve durable session inspection and
logout when Redis is unavailable. No peak, hosting provider or production quota
has been approved.

## Decision

Provide one explicit validated transport profile with four per-minute limits
(HTTP peer, Engine.IO peer, authenticated user connection and user event) and
six process-local capacity bounds. Production API startup requires the complete
profile. Non-production runtime may omit it for existing development fixtures;
a partial profile fails in every environment. Opt-in Gateway composition always
requires an explicit profile, IP admission port, proxy list and production flag.
No quota defaults, production sizing or game activation are selected.

The Realtime infrastructure owns the public Redis transport adapter; HTTP
composition consumes its public IP admission port. This adds no business rules
or Shared utilities. Counters use one atomic Lua operation, a non-renewing
60-second Redis TTL and hashed namespace/subject keys. Only canonical peer IPs
and authenticated UUIDs are subjects; credentials, content and hidden state are
never key material or telemetry. Invalid replies/counters, missing TTL, bounded
queue overflow and connection/command deadlines return safe unavailability.

HTTP admission runs before body parsing, bearer verification and owning ports,
including unknown routes and preflight. Known-origin/HTTPS/drain denials may
return earlier. Local concurrency slots survive a client abort until actual
application work settles; TCP connection limits and existing header/body/time
bounds also apply. On quota-store unavailability, GET/HEAD and durable logout
continue under the local work bound and their existing owner authorization and
outage policies. Other mutations fail closed. Exhausted healthy quotas return
429 with Retry-After. Operational/private Bot listeners retain their own policy.

Engine.IO middleware covers polling, upgrades, invalid session identifiers and
preflight before transport verification/allocation. Namespace attempts are also
IP-admitted before schema/authentication, with a separate bounded authentication
work count. HTTP and Engine.IO share explicit IP/CIDR trust rules; untrusted
forwarding cannot select a budget or assert HTTPS. IPv4-mapped IPv6 and equivalent
IPv6 forms share counters. Production Engine.IO requires TLS or exact HTTPS
forwarding from an explicitly trusted peer. Polling denial uses the stable error
envelope; the library closes denied WebSocket upgrades without a Socket namespace
acknowledgement. No new wire event/version is introduced.

Authenticated incoming events, including unknown/malformed/unacknowledged
messages, enter bounded per-socket/process queues and consume the shared user
event budget before durable session work. Unacknowledged messages cannot mutate.
Owner ports retain identity, membership, role, state, capacity, version, turn and
rule authority. Subscription cardinality is bounded; repeated joins are
idempotent. Heartbeats coalesce while one is pending. Disconnect cleanup reserves
one serialized slot per admitted connection, so saturation/draining cannot lose
presence cleanup or an admitted command's outcome.
Pending disconnect cleanup retains transport capacity until it settles, bounding
reserved work even under repeated connection churn. Slow fanout capacity failures
reject publication for at-least-once retry/resync; no durable event is discarded.

Revalidate bound durable identity/expiry after recipient reads and before private
snapshot/admission/chat output. Match membership loss removes its subscription
cursor. Continue the existing recipient projection and content-free Redis wakeup
boundaries. Drain admission checks, namespace lookups, accepted commands and
disconnect cleanup before clients/DB teardown.

With Presence enabled, lost Match membership also closes the transport so its
retained lease subscriptions cannot accumulate outside the socket room bound.
Cleanup uses the existing Presence close port; no lease/timeout/takeover policy
changes. Other subscriptions can be restored through normal authorized reconnect.

## Alternatives

- Process-local rate counters alone: cannot enforce one quota across nodes.
- Apply a blanket Redis failure denial: would break approved durable inspection,
  logout and feature-specific outage behavior.
- Supply generous hard-coded production limits: would silently decide OD-001
  capacity and could mask incomplete deployment configuration.
- Authenticate before admission or rely only on namespace middleware: leaves
  repeated invalid credentials and transport requests ahead of expensive work.

## Consequences

Production configuration must now explicitly provide the whole profile. Numeric
ceilings validate finite resources; they are not recommended quotas or capacity
evidence. Operators must use identical quota values and namespace on all nodes,
sanitized forwarding at their ingress, and review NAT/IPv6 rotation, polling and
reconnect traffic before deployment. Namespace admission deliberately also
consumes the Engine.IO IP budget. Fixed windows permit boundary bursts; local
work/connection bounds remain independent protections during Redis failure.

Additional post-read session lookups trade DB work for a narrower revocation
window; normal membership checks remain with the owning read/transaction. This
does not claim atomic network delivery with revocation or protection against raw
network/TLS exhaustion. Edge controls, numeric policy approval, staging HTTPS,
reconnect-storm/load/soak evidence and production rollout remain OD-001/002/007,
17B/17C/18B gates. Session strategy, takeover, retention and public contracts are
unchanged. Browser/admin policy belongs to unauthorized 17A3.

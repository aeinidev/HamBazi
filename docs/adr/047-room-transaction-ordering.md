# ADR-047 — Order Room transactions before their Serializable snapshot

- Status: Accepted within owner-authorized Phase 17CR; targeted local validation complete; production capacity acceptance unproven, MVP completion policy now ADR-048
- Owner: HamBazi implementation maintainer
- Date: 2026-10-07
- Supersedes: none; supplements ADR-019

## Context

The approved normal profile fails on Room admission during Match turnover. A
controlled PostgreSQL overlap reproduces a join abort at the roster delete while
an unrelated Room closes. Both transactions have read their separate Room/roster
records. The original observation has separate tuple predicate locks and page-level index
predicates. The explicit follow-up after ordered fixture setup records two
relation-level predicate locks on `rooms`: point queries have selected table scans
on this small relation. Both transactions consequently register read dependencies
on the whole Room relation, then update different Room status/revision rows.
Closure commits before the join rewrites its roster; the latter aborts with a
serialization conflict. Coarse predicate dependencies can thus couple logically
separate workflows under PostgreSQL SSI; an index-page sample alone did not prove
a shared primary-key page.

Removing the roster rewrite is insufficient: the same overlap instead aborts at
the new membership insert. No additional retry, timeout, quota, pool capacity or
weaker isolation is justified by that experiment. The controlled regression
retains a test-only bypass to demonstrate the original conflict and separately
checks the production ordering behavior.

## Decision

Before the first snapshot-bearing statement of each Room repository transaction,
acquire `LOCK TABLE rooms IN SHARE ROW EXCLUSIVE MODE`. Expose only the fixed
`lockRooms()` primitive on the Rooms-owned scoped transaction client. Calling it
outside a transaction fails; other owners receive no such method or arbitrary SQL.
PostgreSQL releases the lock on commit or rollback, across API processes.

Room repository transactions include reads that can materialize expiry, receipt
checks and trusted start/close operations. They use one acquisition order, before
any Room/roster/receipt read. The existing Serializable isolation, five attempts,
post-rollback jitter, acquisition/transaction timeouts and public error semantics
remain. Bounded recovery-page enumeration uses the existing nontransactional
read port. Match, Users, Auth and other owners do not acquire this lock.

Keep the existing roster persistence algorithm; the unsuccessful delta-only
experiment is not part of this repair. No schema, index, grant, engine, credential
or wire-contract change is needed. Room transactions contain no external network
call or application-port call. Live actor, invite, eligibility, host, capacity,
revision, expiry and receipt checks remain in their owning application/repository.

## Alternatives

Increasing retries or time budgets can mask the conflict while adding work.
Changing isolation would require new correctness proofs. A lock per Room cannot
prevent a coarse-predicate conflict between different Rooms. Planner tuning or
partitioning would broaden the change and still needs physical contention proof.
Rewriting only changed members reduces work but does not eliminate this cycle.

## Consequences

Room transactions queue across processes rather than creating overlapping SSI
read/write dependencies. This reduces Room concurrency and can create pool/lock
waits; it is a deliberate internal ordering trade-off, measured under the unchanged
approved workload. It does not establish a new product quota or capacity promise.
The existing transaction timeout bounds a stalled holder; rollback releases the
lock. Related regressions must prove fresh snapshots after waiting, atomic
membership/receipts and successful overlapping admission/start/close/recovery.

Full capacity, reconnect, soak and production-like staging acceptance remain
Phase 17C gates. The lock is not evidence that downstream gameplay/fanout capacity
issues have been resolved.

The controlled original cycle, fresh-snapshot waiting regression and eight-wave
turnover test pass in the 272-test isolated native harness. Unchanged normal/stress
and independent stress repeats record two and one Room transaction conflicts,
respectively, without Room INTERNAL_ERROR or HTTP 503. Both stop on connected
Match catchup acknowledgement failures. At their first-failure probes completed
Room transactions have p95 upper bounds of 50 ms and maxima of 135.191 ms and
89.581 ms. These are local observations, not a staging capacity promise or proof
that all accepted commands have been reconciled. See the Phase 17CR checkpoint
in the implementation plan for failed gates and retained evidence.

References: [PostgreSQL 18 Serializable isolation](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-SERIALIZABLE)
and [table lock modes](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-TABLES).

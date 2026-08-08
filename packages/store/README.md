# Owned operational store

The four-table single-file SQLite store decided by protocol 6.5 —
`design/operations/storage-decision.md` — **ratification pending** under
the stage-four review. Built ahead of stage five because every layer of
the platform foundation rests on it.

| Table | Role | Evidence status |
|---|---|---|
| `seen_delivery` | atomic webhook acceptance and work queue: opaque GUID, event name, exact payload bytes, SHA-256 digest, receipt/completion times, and claim state | GUID dedup was decided in 6.5; durable intake semantics are exercised by this package's restart and two-thread contention tests |
| `effect_journal` | intent/done write-ahead rows with revision, durable attempt counter, and completion timestamp; the recovery loop's detector | crash-proven in the 6.5 sandbox grid; attempt counter and done-immutability added under D42 |
| `effect_claim` | one-winner LEASE per effect: atomic stale takeover, released on completion | race-proven in the 6.5 sandbox grid; lease semantics added under D41 |
| `schedule` | clock-triggered work; `pending → running → done`, with claim age and a per-firing completion token | decided in 6.5; restart/requeue mechanics are pre-covered here; `claimed_at` and claim tokens prevent stale completion under D43 |

Design rules (from the evidence, not preference): state transitions are
synchronous SQLite writes, and delivery acceptance commits before it
returns; tables are independent — no foreign keys, no joins;
`sentUnknown` is deliberately unresolvable from the journal
alone — callers must resolve against GitHub state before retrying (the
recovery loop in the storage decision). The store never reads the
clock: every timestamp is caller-supplied and validated as exactly the
`Date.toISOString()` shape (millisecond-precision UTC `Z`) — one
constant-width format, so lexicographic order is chronological order,
which every `<=` comparison relies on; anything else (offsets, mixed
precision) throws instead of misordering silently.

Three store findings, argued in full in their register rows:

- `FINDING(store-claim-lease)` → **D41** — claims are leases: atomic
  stale takeover, `release` frees only the holder's own row; a stolen
  lease is survivable because the journal plus GitHub re-read is the
  correctness layer.
- `FINDING(store-journal-attempts)` → **D42** — `done` rows are
  immutable to `intent`; retries increment a durable `attempt` counter,
  so retry bounds survive restart. Completion refreshes the retention
  timestamp so an old open attempt is not immediately pruned when resolved.
- `FINDING(store-sweep-api)` → **D43** — `requeueStuck(claimedBefore)`
  returns stuck `running` schedules to `pending` (stuckness = claim
  age); `openIntents(before)` is the recovery loop's worklist; requeued
  work re-enters `claimDue`. `pruneCompletedDeliveries` and
  `pruneDoneJournal` support the adopted 90-day retention (executor
  `policy.ts`); pending/processing deliveries and open `sent` journal
  rows are never pruned.

## Durable webhook intake boundary

GUID-only deduplication had a demonstrated P9 loss window: a receiver
could record the GUID, acknowledge GitHub, and crash before retaining
the payload or creating work. A redelivery would then find the GUID and
be suppressed even though no recoverable work existed.

`acceptDelivery` closes that store-level window by committing the
delivery GUID, verified event name, exact verified payload bytes,
SHA-256 digest, receipt timestamp, and pending state as one durable
record. An identical GUID/event/payload returns `duplicate` with the
current state. Reusing a GUID with a different event name or payload
digest returns `conflict`; neither result overwrites the original.
There is no identity-only insertion API.

`claimNextDelivery` atomically moves one deterministically selected row
to `processing` and returns its event name and exact bytes with a fresh
256-bit claim token. It can take over a processing row whose claim is at
or before the caller's stale boundary. `releaseDelivery` and
`completeDelivery` are conditional on that token, so an earlier worker
cannot mutate a replacement claim. Completion changes the state to
`done` and clears payload bytes in the same statement while retaining
the GUID, event name, digest, receipt time, and completion time.
`requeueStuckDeliveries` provides the explicit reconciliation path.
Retention pruning can delete only completed rows at or before its
caller-supplied boundary.

The payload is an opaque byte array at this boundary. The store does
not parse JSON, inspect repositories, verify signatures, normalize
events, log bodies, or scrub payloads. Callers supply canonical UTC
timestamps; the store never reads the clock.

This is the durable store contract, not end-to-end webhook durability.
A production HTTP receiver still must verify the signature before
acceptance and acknowledge GitHub only after an `accepted` or
`duplicate` result. Queue-capacity/backpressure policy, the event
normalizer, hosting, and the reconciliation service are also still
missing. Existing pre-ratification database files with the old
two-column `seen_delivery` table are not migrated by this package; a
fresh database is required.

Requires Node 23.4+ — `node:sqlite` needs `--experimental-sqlite` on
22.x and runs unflagged from 23.4. Node 24.11.1 still emits a non-failing
`ExperimentalWarning`. Part of the repository's pnpm
workspace — `pnpm install` at the repository root links the
`@hiero-hackers/automation-core` dependency (branded `DeliveryGuid`).
`pnpm test` runs typecheck plus the crash-simulation suite (fresh
instance on the same file = the restarted process).

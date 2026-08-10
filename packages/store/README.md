# Owned operational store

The single-file SQLite store decided by protocol 6.5 and amended by D110 —
`design/operations/storage-decision.md` — **ratification pending** under
the stage-four review. The recovery experiment required four operational
tables; the delivery completion boundary adds a fifth canonical-report table.

| Table | Role | Evidence status |
|---|---|---|
| `seen_delivery` | atomic webhook acceptance and work queue: opaque GUID, event name, exact payload bytes, SHA-256 digest, receipt/completion times, and claim state | GUID dedup was decided in 6.5; durable intake semantics are exercised by this package's restart and two-thread contention tests |
| `effect_journal` | intent/done write-ahead rows with revision, durable attempt counter, and completion timestamp; the recovery loop's detector | crash-proven in the 6.5 sandbox grid; attempt counter and done-immutability added under D42 |
| `effect_claim` | one-winner LEASE per effect: atomic stale takeover, released on completion | race-proven in the 6.5 sandbox grid; lease semantics added under D41 |
| `schedule` | clock-triggered work; `pending → running → done`, with claim age and a per-firing completion token | decided in 6.5; restart/requeue mechanics are pre-covered here; `claimed_at` and claim tokens prevent stale completion under D43 |
| `delivery_report` | the canonical serialized shell record and the claim token that committed it, one row per delivery | report persistence plus delivery completion is crash-atomic; worker-thread fault injection covers both uncommitted steps and the committed boundary (D110) |

Design rules (from the evidence, not preference): state transitions are
synchronous SQLite writes, and delivery acceptance commits before it
returns; tables have no foreign keys, while delivery finalization deliberately
updates `delivery_report` and `seen_delivery` in one transaction;
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

The two source files answer separate questions:

| File | Question |
|---|---|
| [`src/schema.ts`](src/schema.ts) | Which owned database format is this, and how does it reach the current version safely? |
| [`src/store.ts`](src/store.ts) | Which operational state transition may commit now? |

## Version contract and migration

`PRAGMA user_version` is the explicit SQLite-native schema marker; the current
version is `4`. A declared version above `4` is refused before the store changes
the database. Version-zero files are accepted only when every owned SQLite
object matches one of the three schemas this repository created. The fingerprint
includes exact table and index definitions, so column types, nullability,
primary keys, checks, partial-index predicates, and the absence of triggers or
views are enforced together. Unknown or altered shapes fail closed.

All required migrations run in order inside one `BEGIN IMMEDIATE` transaction,
including each `user_version` update. An interruption therefore leaves the
entire pre-migration schema or the complete current schema; reopening repeats
the same ordered work. Fixtures reproduce all three old definitions, and
fault injection interrupts every migration step before reopening the file.

Information an old schema never stored cannot be reconstructed. Identity-only
delivery rows migrate as completed legacy identities with an unknown event and
digest, so a later redelivery conflicts rather than silently reprocessing.
Original journal rows receive attempt `1` and revision `legacy:unknown`, which
cannot pretend to match a current plan. Original `running` schedules had no
ownership token and return to `pending`. Deliveries already completed before
version 4 remain valid but have no invented report row.

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
`completeDeliveryWithReport` are conditional on that token, so an earlier
worker cannot mutate a replacement claim.

`completeDeliveryWithReport` verifies the GUID, event name, payload digest,
processing state, and current claim token under one write lock. It inserts the
canonical report and changes the delivery to `done` in the same transaction,
clearing payload bytes while retaining delivery identity. The report row keeps
the committing token: retrying the same token with the same canonical bytes
returns `alreadyCompleted`; another token returns `notOwned`, and the same token
with changed report bytes returns `reportConflict`. Thus every completion
performed through the version-4 contract has exactly one report. The exception
is explicit: a delivery already done when an older schema is migrated may have
no report because none existed to recover.

`deliveryReports` reads every canonical report in stable completion-time then
delivery-ID order. It is the store-side replay boundary for rebuilding any
derived operator projection; reportless completions migrated from version 3
are omitted because the migration does not invent their missing bytes.

`requeueStuckDeliveries` provides the explicit reconciliation path.
Retention pruning deletes an eligible delivery and its report in one
transaction; pending and processing work is never eligible.

The payload is an opaque byte array at this boundary. The store does
not parse JSON, inspect repositories, verify signatures, normalize
events, log bodies, or scrub payloads. Callers supply canonical UTC
timestamps; the store never reads the clock.

This is the durable store contract, not end-to-end webhook durability.
A production HTTP receiver still must verify the signature before
acceptance and acknowledge GitHub only after an `accepted` or
`duplicate` result. Queue-capacity/backpressure policy, the event
normalizer, hosting, and the reconciliation service are also still missing.

Requires Node 23.4+ — `node:sqlite` needs `--experimental-sqlite` on
22.x and runs unflagged from 23.4. Node 24.11.1 still emits a non-failing
`ExperimentalWarning`. Part of the repository's pnpm
workspace — `pnpm install` at the repository root links the
`@hiero-hackers/automation-core` dependency (branded `DeliveryGuid`).
`pnpm test` runs typecheck plus the crash-simulation suite (fresh
instance on the same file = the restarted process).

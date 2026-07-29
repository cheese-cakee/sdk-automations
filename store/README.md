# Owned operational store

The four-table single-file SQLite store decided by protocol 6.5 —
`design/operations/storage-decision.md` — **ratification pending** under
the stage-four review. Built ahead of stage five because every layer of
the platform foundation rests on it.

| Table | Role | Evidence status |
|---|---|---|
| `seen_delivery` | delivery dedup by guid (opaque string — ids exceed 2^53) | decided in 6.5; exercised by this package's tests |
| `effect_journal` | intent/done write-ahead rows with revision, durable attempt counter, and completion timestamp; the recovery loop's detector | crash-proven in the 6.5 sandbox grid; attempt counter and done-immutability added under D42 |
| `effect_claim` | one-winner LEASE per effect: atomic stale takeover, released on completion | race-proven in the 6.5 sandbox grid; lease semantics added under D41 |
| `schedule` | clock-triggered work; `pending → running → done`, with claim age and a per-firing completion token | decided in 6.5; restart/requeue mechanics are pre-covered here; `claimed_at` and claim tokens prevent stale completion under D43 |

Design rules (from the evidence, not preference): every write is one
synchronous statement so crash state is always "everything before the
last returned call"; tables are independent — no foreign keys, no
joins; `sentUnknown` is deliberately unresolvable from the journal
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
  work re-enters `claimDue`. `pruneSeen`/`pruneDoneJournal` enforce the
  adopted 90-day retention (executor `policy.ts`); open `sent` rows are
  never pruned, and 90 days is 3× GitHub's own 30-day redelivery
  horizon, so a forgotten guid cannot recur as a ledger redelivery.

Requires Node 23.4+ — `node:sqlite` needs `--experimental-sqlite` on
22.x and runs unflagged from 23.4. Node 24.11.1 still emits a non-failing
`ExperimentalWarning`. Part of the repository's pnpm
workspace — `pnpm install` at the repository root links the
`@hiero-hackers/automation-core` dependency (branded `DeliveryId`).
`pnpm test` runs typecheck plus the crash-simulation suite (fresh
instance on the same file = the restarted process).

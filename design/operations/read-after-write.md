# Read-after-write staleness

> Conclusion of protocol 6.7 (2026-07-25), the measurement register row D46 required. Evidence log:
> `6.7-read-after-write-2026-07-25T21-00-55-057Z.jsonl` (local, untracked, per the experiments
> convention).

## Question

The recovery loop's exactly-once guarantee is proven relative to a consistent read-back (D46). How stale
is the real read the resolver uses, immediately after a write returns?

## Measured

On a dedicated probe issue in the personal sandbox, paced ~2 s per trial:

| Write → read | Trials | Visible on FIRST immediate read | Median to visible | p95 | Max | Citation |
|---|---|---|---|---|---|---|
| create comment → list comments | 25 | **25 / 25** | 299 ms | 462 ms | 514 ms | `2026-07-25T21-00-55-057Z#79` |
| add label → read issue | 15 | **15 / 15** | 238 ms | 352 ms | 352 ms | `2026-07-25T21-00-55-057Z#140` |

The to-visible times include the confirming read's own round-trip (~200–300 ms); with every trial visible
on the first read, **no replication staleness was observed at all** — the measured "lag" is HTTP latency,
not eventual consistency.

## Honest limits of the measurement

Forty trials, one repository, one day, low write contention, REST list endpoints only. GitHub documents no
read-after-write guarantee, so this is evidence of *typical* behavior, not a contract. A rare stale read
remains possible, and the failure it would cause (a duplicated non-idempotent effect) is exactly the one
the design exists to prevent — so the rule below spends one cheap delay on the asymmetric side anyway.

## The freshness rule this decides

- `readBack` may answer **"present" on first sight** — a visible effect is a landed effect.
- `readBack` may answer **"absent" only after two reads at least one second apart** (observed p95 is
  462 ms; 1 s is ~2× that). "Absent" triggers a re-send, and for non-idempotent calls a wrong "absent"
  duplicates — the second read is insurance priced at one API call, only on the rare recovery path.

The rule is encoded as `READBACK_ABSENT_READS` and `READBACK_CONFIRM_ABSENT_DELAY_MS` in
`packages/executor/src/policy.ts`; the stage-five port implements it, and the D46 register row records this
document as its measured basis. Re-measure if the resolver gains a GraphQL or search-based read — those
paths were not measured and search indexing is known to lag.

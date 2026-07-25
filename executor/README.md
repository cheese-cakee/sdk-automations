# Recovery-loop executor

The recovery loop `design/operations/storage-decision.md` decided —
journal detects, GitHub resolves, the declared idempotency class rules
the retry — as an engine over two injected boundaries: the owned store
(`@hiero-hackers/automation-store`) and an `EffectPort` (the only exit
to GitHub). **Candidate implementation pending stage-four ratification**,
like the store it drives; built ahead as parallel-track work because its
tests are the design's own crash grid, automated.

| Piece | Implements | Source of truth |
|---|---|---|
| `src/recovery.ts` | The recovery flowchart: neverStarted / midSequence / sentUnknown → read-back → class-ruled retry; claim/release lifecycle; the two surfaced stops | storage-decision.md §"The recovery loop the grid decided"; `manual-edits.md` §9 (stale plans) |
| `test/harness.ts` | The adversarial world: crash-by-invocation port, application-counting fake GitHub, restart-with-lease-takeover runner | protocol 6.5's kill-point method |
| `test/crash-grid.test.ts` | Every single crash point, all 64 crash pairs, seeded multi-crash histories — all must converge with the non-idempotent call applied exactly once | the 6.5 sandbox grid, exhaustive |
| `test/recovery.test.ts` | Each flowchart branch; the surfaced stops; the reproduced 6.5 blind-retry duplication the read-back exists to prevent | storage-decision.md; D41–D43 |

A `perform` throw IS the crash model: the engine never catches it and
never releases the claim on the way down — a dead process releases
nothing, and D41's lease takeover is what unblocks the effect.

Findings for the decision register:

- `FINDING(executor-attempt-bound)` → **D44** — "bounded history" names
  no bound; `MAX_CALL_ATTEMPTS = 5` encoded so the question cannot be
  silently skipped.
- `FINDING(executor-stale-plan)` → **D45** — an open journal row that no
  longer matches the plan surfaces as unresolved; the engine never maps
  old intents onto a new revision.
- `FINDING(executor-readback-consistency)` → **D46** — the crash grid's
  exactly-once results are proven relative to a perfectly consistent
  read-back; real GitHub reads lag writes, so the real port owes a
  confirmed-fresh read before answering "absent". The grid's world is
  deliberately kinder than GitHub, and says so.

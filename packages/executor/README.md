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
| `src/commands.ts` | The adapter boundary: the typed command contract, the plan shape, and the `EffectPort` an adapter implements. Vocabulary only — the planner builds these, the recovery loop drives them, and an adapter needs no other file here | `design/modules/contract.md` §5; D13 (read-back kinds) |
| `src/recovery.ts` | The async recovery flow: neverStarted / midSequence / sentUnknown → read-back → bounded retry; revision check; claim/release lifecycle; surfaced stops | storage-decision.md §"The recovery loop the grid decided"; `manual-edits.md` §9 (stale plans) |
| `src/policy.ts` | The adopted operational numbers — lease, requeue staleness, retention, read-back freshness — in one greppable home so they cannot drift from the register silently | the 2026-07-25 adoption record; D41, D43, D46 |
| `src/planner.ts` | The seam contract.md left unowned: capability intents → safety gate → typed `EffectPlan`. One intent, one plan; dry-run stops here rather than at the port | `design/modules/contract.md` §3, §5; D65–D69 |
| `test/harness.ts` | The adversarial world: crash-by-invocation port, application-counting fake GitHub, restart-with-lease-takeover runner | protocol 6.5's kill-point method |
| `test/crash-grid.test.ts` | Reachable perform crashes, 64 scheduled two-point histories, and seeded histories converge under a serialized, consistent fake; the test reports how many scheduled crashes actually fire | the 6.5 sandbox grid, bounded local evidence |
| `test/recovery.test.ts` | Each flowchart branch; the surfaced stops; the reproduced 6.5 blind-retry duplication the read-back exists to prevent | storage-decision.md; D41–D43 |

A rejected `perform` promise IS the harness crash model: the engine never catches it and
never releases the claim on the way down — a dead process releases
nothing, and D41's lease takeover is what unblocks the effect.

The harness does not prove that taking a lease from a still-live worker
is safe. An in-flight non-idempotent request cannot be fenced by SQLite;
D41 is reopened pending an adapter deadline/renewal design and an
overlapping-worker oracle.

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

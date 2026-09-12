# Capabilities — one folder each, one registry

The capabilities the shell composes. Each lives in `src/<name>/` — its declaration and
`evaluate`, its settings, its own tests, and the design doc it is built against — and
`src/index.ts` lists them as `CAPABILITIES`. The shell composes that list and names no
capability, so adding one is a folder and a line.

The three here were built as boundary stubs and redesignated by the capability-suite
redesign: they are the **seeds** of their real capabilities, promoted in place against
their design docs, not deleted. They were chosen for contract diversity, not demand — so
a seed may need real surgery against its design doc, not polish.

## Why this exists

The runnable shell composes these capabilities to exercise the capability boundary and
produce observe or dry-run decisions. They also keep the capability-isolation matrix
concrete without treating any seed as product scope.

What they found is recorded as
D61–D73 in [`design/history/decisions.md`](../../design/history/decisions.md); eight of the thirteen
rows are gaps that no further work inside a single package would have
surfaced, because each package was individually correct. D72 needed more than
that again — it appeared only when this branch met the 2026-07-30 audit's
immutable destructive warnings, and neither change produced it alone.

## Adding a capability

One folder and one line:

1. `src/<name>/capability.ts` — the declaration and the `Capability` object with `evaluate`.
2. `src/<name>/settings.ts` — the spec of the settings it reads from its `settings:` block, built
   from core's settings toolkit (`design/guides/capability-kits.md` §3).
3. `src/<name>/capability.test.ts` — its own branches.
4. `src/<name>/design.md` — the design it is built against, moved here from
   `design/guides/capabilities/` the moment the folder exists.
5. One line in `src/index.ts`: the named exports, and the entry in `CAPABILITIES`.

P3 then covers it with **zero test edits** — `test/engine-matrix.test.ts` derives its
capability list and its subsets from the registry, so the matrix grows on its own (D131).

## Why these three

Chosen for **contract diversity**, deliberately not for likelihood of being
ranked first — picking probable winners would have made this a scope decision
nobody made.

| Capability | The only one that… |
|---|---|
| `prQuality` | touches almost nothing: one resolver, one comment, no state, no mappings |
| `intake` | consumes mapped meanings, emits two intents from one record, and declares **no** resolvers — so it is also the test that an undeclared resolver is unreachable |
| `inactivity` | is schedule-triggered, reads both fact kinds, and is the only one needing every fact group — two ladders, a clock per assignee, and the platform's only clock-triggered destructive acts |

Between them: event vs. schedule, idempotent vs. non-idempotent,
mapping-consuming vs. not, and stateless vs. `durableState: required`.
Together they exercise the retained boundary without selecting a product capability.

## What the tests prove

| Suite | Claim |
|---|---|
| `test/boundary.test.ts` | The direct declaration set is admitted; the config projection leaks neither another capability's block nor a repository label string; the intent screen refuses undeclared, misattributed, and unprojected label intents |
| `test/engine-matrix.test.ts` | **P3**, tested: all eight subsets, each capability's behaviour identical regardless of neighbours, disabled capabilities never evaluated, with a negative control so the matrix cannot pass vacuously |
| `src/prQuality/capability.test.ts` | A resolver that could not answer is never read as "no linked issue" — the sweep explains and emits nothing, while the same pull request with a real empty answer draws the comment |
| `src/intake/capability.test.ts` | Without a mapped `awaitingTriage` the sweep explains and skips; an item positioned anywhere is left alone, because intake is the entry gate only |
| `src/inactivity/capability.test.ts` | Its design's Verified-by rows, one title each: which clock is running and what resets it, which reason governs a pull request and whose wait it is, and who is named in the reminder the act carries. Since `design/guides/grace.md` there is ONE intent per stale thing and it is the act — the reminder rides on it as `grace.warning.body` — so acts are dated at the clock's start, and the last block runs the same records through `decide()` with a stubbed `warningFor` to show the platform warning first and acting only after. A bot or undetermined assignee is dropped precisely where the next step is destructive |
| `test/settings.test.ts` | Each seed's spec reads the keys its declaration admits, with the defaults it documents — and a block a seed cannot read is reported on the operator surface instead of quietly falling back to one |

The shared suites stay in `test/` because they answer for the whole package rather than
for one module; a capability's own spec sits beside it.

A capability's test titles follow the rows of its design's **Verified by** table, by convention:
that table is the test agenda, and a row a seed cannot yet reach is a build, not a rename.

The P3 run is the one worth flagging: an earlier plan deferred the toggle matrix until a
second shipped capability existed, because one capability cannot violate the principle.
That was right about the arithmetic and wrong about the prerequisite — P3 is structural,
so seeds test it as well as shipped code does
([`history/decisions.md`](../../design/history/decisions.md), D70); the matrix is re-run per capability.

`test/world.ts` is the shared fixture worth reading first: `configEnabling` builds the
config and the evaluation list from the same capability list, written as the smallest
thing that could work.

## What it does not prove

- Nothing about live GitHub correctness. Active mode is implemented, but only `APP_SLUG` arms the
  write path and the sandbox protocols remain the evidence for it.
- Nothing about demand. These are not candidate capabilities.
- Nothing about effect recovery or live lease takeover.

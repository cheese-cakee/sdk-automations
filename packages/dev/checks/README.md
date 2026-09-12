# automation-checks (tests about the repository)

Tests about the **repository**, not about any package: docs and examples stay true to core's
vocabularies, design diagrams match the edge tables, artifacts hold their invariants. It depends on
core and the capability registry through their public barrels.

**There is no `src/`, and that is the point.** Nothing in this package can kill a mutant, so nobody
can mistake a repository check for a package test — and the mutation gate on `core/` cannot be
flattered by tests that were never going to reach its code. If a test here starts needing more than
core's barrel, it has probably stopped being a repository check.

## What belongs here

Two rules, both from the register.

**Inclusion (D85).** A test that reads another package's files, or the repository root, goes here; a
test that can kill a mutant in a package's `src/` stays in that package. This boundary was not
theoretical: four such tests once lived in `core/test/`, which meant core's suite failed when a
markdown file changed, and the rejection fixtures scored `document.ts` at 0.00% mutation because
Stryker's sandbox is the package directory and root-level files are not in it.

**Naming (D89).** One file per watched **target** (`docs`, `examples`, `lab`) or per **invariant**; a
target earns a subdirectory only when it needs a second file. The rule exists because the original
single artifacts file had absorbed seven unrelated `describe`s and the next reader would have added
an eighth. The architecture check rejects test files with generic names.

The standing risk is drift toward a junk drawer — this package accepting behaviour tests because it
is convenient. The no-`src/` shape is the guard. Its capability dependency reads the shipped
registry so documentation cannot drift from runtime composition.

## The invariants

One file per invariant, and each check's header states the invariant it holds. `test/*.test.ts` is
the list; there is no second copy of it here.

Every one carries a negative control — a case asserting the check would still fail if the thing it
guards regressed. A check that cannot fail is not a check, and several of these were written only
after a silent-when-wrong failure proved the point.

## Running them

```bash
pnpm --filter @hiero-hackers/automation-checks test
```

The contract tables of `design/contracts/catalogue.md` and `design/contracts/safety.md` are rendered
from core's registries by `test/generated.ts`, so the two drift checks compare whole blocks and
`pnpm contracts` (this package's `generate` script) is the fix when one goes red.

They also run as part of `pnpm -r test`. They read the working tree as git would record it — tracked
files plus untracked files the ignore rules admit — so a new file is judged before it is committed; only
the never-tracked check reads the index, because tracking is its question.

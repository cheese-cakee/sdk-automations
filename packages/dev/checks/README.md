# automation-checks — tests about the repository

Tests about the **repository**, not about any package: documents and examples stay true to core's
vocabularies, generated blocks match the registries they come from, and the tree holds its
invariants. It reaches core and the capability registry through their barrels, and never ships.

**There is no `src/`, and that is the point.** Nothing here can kill a mutant, so a repository check
cannot be mistaken for a package test, and no package's mutation gate can be flattered by tests that
were never going to reach its code. A test that reads another package's files or the repository root
belongs here; one that can kill a mutant stays in that package (D85).

One file per watched target or per invariant, each stating its invariant in its header, each carrying
a negative control — a check that cannot fail is not a check (D89). `test/*.test.ts` is the list, and
there is no second copy of it here. The checks read the working tree as git would record it, so a new
file is judged before it is committed.

```bash
pnpm --filter @hiero-hackers/automation-checks test   # they also run under pnpm -r test
pnpm contracts                                        # the repair when a generated block drifts
```

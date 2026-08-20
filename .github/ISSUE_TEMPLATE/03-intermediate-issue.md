---
name: "Intermediate Issue"
about: A multi-module task requiring independent research and thorough testing (~25 hours)
labels: "intermediate"
---

<!-- Everything outside "The task" is boilerplate — leave it, or trim what doesn't apply. -->

> 🧑‍💻 **Intermediate Issue** — a complex task spanning multiple modules, with real design decisions to own.
> **Time:** ~25 hours · **Prerequisites:** comfortable navigating this repo and good understanding of context (4+ [beginner issues](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+state%3Aopen+no%3Aassignee+label%3Abeginner) is the usual route; demonstrated CI/CD proficiency substitutes for workflow-focused issues).
> We expect more than "it works": maintainable code that fits the existing architecture.

## The task

<!-- ✍️ Author: this is the only section you write, for someone who can already
     navigate the packages and their tests. Name the modules and the constraints
     you know about — the contributor owns the design. -->

**Why We Need Help:**
<!-- ✍️ Author: one line each, not a paragraph. If you cannot fill the third line, this is probably a beginner issue. -->
<!-- ✍️ what breaks, is missing, or costs time right now -->
<!-- ✍️ which modules carry it, and who feels it -->
<!-- ✍️ the constraint, invariant, or history that puts this above beginner -->

**What Done Looks Like:**
<!-- ✍️ Author: the observable end state a reviewer could check — not the method, which is the contributor's to design. If you already know the method, this is probably a beginner issue; if you cannot describe the finish line either, it is an advanced one. Additionally outline the testing expectations. -->

**Modules Involved:**
<!-- ✍️ Author: the packages or directories this reaches, and in one clause what each contributes. Naming a module the contributor would have missed is the most useful thing on this template -->

**Constraints:**
<!-- ✍️ Author: what the solution must not break — an invariant, a house rule, a decision row, a permission ceiling, a performance budget. Cite the row or the check where one exists. Leave the approach open; these are the walls, not the route -->

## How to work on this

1. **Claim it:** comment `/assign` on the issue and wait to be assigned before opening a PR.
2. **Propose your approach as a comment before coding.** A paragraph is enough; early feedback here routinely saves days of rework.
3. **Check the house invariants** in the [contributor guide](https://github.com/hiero-hackers/sdk-automations/blob/main/CONTRIBUTING.md#ground-rules-for-changes) — one fact, one place; every check gets a negative control; never weaken a mutation threshold — and the [signing requirements](https://github.com/hiero-ledger/sdk-collaboration-hub/blob/main/guides/issue-progression/for-developers/signing.md). AI assistance is welcome within the [AI policy](https://github.com/hiero-hackers/sdk-automations/blob/main/AI_POLICY.md); purely AI generated PRs are not accepted.

**Research is the job at this tier.** A design that fights the existing architecture costs more to
review than it saves to write, so read before you decide:

- [architecture](https://github.com/hiero-hackers/sdk-automations/blob/main/design/architecture.md) — the system as diagrams, each naming the code that falsifies it
- [decision register](https://github.com/hiero-hackers/sdk-automations/blob/main/design/decisions.md) — why things are the way they are, and what would reopen them
- the README of every package you plan to touch — each states its own boundary

**Before opening your PR:**

- [ ] I proposed my approach on this issue and incorporated any feedback
- [ ] The solution fits the existing architecture and house invariants, and is clear enough for others to debug without me
- [ ] Tests cover the happy path, edge cases, and error handling
- [ ] I reviewed my own diff line by line; scope is limited to this issue
- [ ] The PR description links this issue with `Closes #<number>`
- [ ] `pnpm -r test` and `pnpm lint` pass
- [ ] My commits are signed off for DCO: `git commit -s -m "fix: description"`

**Stuck?** Comment here with what you have tried. A maintainer will respond.

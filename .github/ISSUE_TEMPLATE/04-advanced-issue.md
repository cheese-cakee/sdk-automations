---
name: "Advanced Issue"
about: Architectural, multi-module, or core-logic work for proven contributors (~30+ hours)
labels: "advanced"
---

<!-- Everything outside "The task" is boilerplate — leave it, or trim what doesn't apply. -->

> 🧑‍🔬 **Advanced Issue** — the most complex work in this project: architectural, multi-module, or core-logic changes where the solution itself may need discovering.
> **Time:** ~30+ hours · **Prerequisites:** a proven track record here (≥1 completed [intermediate issue](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+state%3Aopen+no%3Aassignee+label%3Aintermediate); demonstrated CI/CD proficiency substitutes for workflow-focused issues).
> The bar is production-ready: safe, maintainable, architecturally sound.

## The task

<!-- ✍️ Author: this is the only section you write. Articulate the problem and its
     system-wide impact. Where the solution is uncertain, say what is unknown and
     what the key risks are — mapping that uncertainty is part of the task. -->

**Problem:**

**Impact / what done looks like:**

**Known unknowns and risks:**

## How to work on this

1. **Claim it:** comment on the issue and wait to be assigned before opening a PR.
2. **Propose your design as a comment before building.** Cover the approach, the alternatives you rejected, and the system-wide impact. For large changes, say how you will split the work into reviewable PRs.
3. **Re-read the architecture and decision records** in [design/](https://github.com/hiero-hackers/sdk-automations/tree/main/design) before locking a design.

**What tends to bite experienced contributors in this repo:**

- `core/` stays pure: moving I/O or clock reads into it is an architecture change, not a convenience.
- The store and recovery layers have explicit leases, journaling, and overlap contracts in `design/decisions.md`; changing them requires the same rigor.
- Fail-closed configuration is a safety property, not a style choice.
- Mutation thresholds are load-bearing; lowering one without a reason is a regression.

**Before opening your PR:**

- [ ] The PR includes a short design/impact note: approach, alternatives considered, affected modules, compatibility impact
- [ ] Correctness, safety, and performance are evaluated, not assumed — and the evaluation is visible in the note or the tests
- [ ] Testing is comprehensive, including deliberate invariant updates where the behavior changes
- [ ] I reviewed my own diff as if it were someone else's

**Review expectations:** advanced PRs get probing questions and may take longer than a day — that is the level working as intended. **Stuck or want a design sounding board?** Comment here with what you have tried.

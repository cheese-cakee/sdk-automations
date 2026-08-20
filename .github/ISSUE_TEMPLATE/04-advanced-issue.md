---
name: "Advanced Issue"
about: Architectural, multi-module, or core-logic work for proven contributors (~30+ hours)
labels: "advanced"
---

<!-- Everything outside "The task" is boilerplate — leave it, or trim what doesn't apply. -->

> 🧑‍🔬 **Advanced Issue** — the most complex work in this project: architectural, multi-module, or core-logic changes where the solution itself may need discovering.
> **Time:** ~30+ hours · **Prerequisites:** a proven track record here with detailed understanding of context (≥5 completed [intermediate issues](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+state%3Aopen+no%3Aassignee+label%3Aintermediate); demonstrated CI/CD proficiency substitutes for workflow-focused issues).
> The bar is production-ready: safe, maintainable, architecturally sound.

## The task

<!-- ✍️ Author: this is the only section you write. Where the solution is uncertain,
     say what is unknown — mapping that uncertainty is part of the task, not a gap
     in the issue. -->

**Why We Need Help:**
<!-- ✍️ Author: in 1-2 sentences summarize the problem and its system-wide impact. Cite the decision row, finding, contract, or guide it touches -->

**What Done Looks Like:**
<!-- ✍️ Author: the end state, as far as it is known. "We do not yet know what good looks like, and finding that out is the task" is a legitimate answer at this tier — then say what would count as progress -->

**Known Unknowns and Risks:**
<!-- ✍️ Author: what is uncertain, what could break, and what would have to be measured or proven. Do not guess the approach on the contributor's behalf -->

## How to work on this

1. **Claim it:** comment `/assign` on the issue and wait to be assigned before opening a PR.
2. **Propose your design as a comment before building.** Cover the approach, the alternatives you rejected, and the system-wide impact. For large changes, say how you will split the work into reviewable PRs.
3. **Re-read the architecture, contracts, guides, and decision records** in [design/](https://github.com/hiero-hackers/sdk-automations/tree/main/design) before locking a design, and the [signing requirements](https://github.com/hiero-ledger/sdk-collaboration-hub/blob/main/guides/issue-progression/for-developers/signing.md). AI assistance is welcome within the [AI policy](https://github.com/hiero-hackers/sdk-automations/blob/main/AI_POLICY.md); purely AI generated PRs are not accepted.

**Research is most of the work at this tier.** What bites experienced contributors here is not the
code — it is carefully considering what we have and building from it, or if needed, improving or changing it.

- [architecture](https://github.com/hiero-hackers/sdk-automations/blob/main/design/architecture.md) — what exists, drawn; [contracts](https://github.com/hiero-hackers/sdk-automations/blob/main/design/contracts) — what the code must keep satisfying; [guides](https://github.com/hiero-hackers/sdk-automations/blob/main/design/guides) — what is not built yet
- [decision register](https://github.com/hiero-hackers/sdk-automations/blob/main/design/decisions.md) — every non-obvious choice, its costs, and what would reopen it
- [findings](https://github.com/hiero-hackers/sdk-automations/blob/main/design/findings) — what was measured against real GitHub, and therefore what you cannot assume

**Before opening your PR:**

- [ ] The PR includes a short design/impact note: approach, alternatives considered, affected modules, compatibility impact
- [ ] Correctness, safety, and performance are evaluated, not assumed — and the evaluation is visible in the note or the tests
- [ ] Testing is comprehensive, including deliberate invariant updates where the behavior changes
- [ ] I reviewed my own diff as if it were someone else's
- [ ] The PR description links this issue with `Closes #<number>`
- [ ] `pnpm -r test` and `pnpm lint` pass
- [ ] My commits are signed off for DCO: `git commit -s -m "fix: description"`

**Review expectations:** advanced PRs get probing questions and may take longer than a day — that is the level working as intended. **Stuck or want a design sounding board?** Comment here with what you have tried.

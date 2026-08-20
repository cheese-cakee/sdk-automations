---
name: "Beginner Issue"
about: A well-scoped task for contributors ready to research the codebase (~8 hours)
labels: "beginner"
---

<!-- Everything outside "The task" is boilerplate — leave it, or trim what doesn't apply. -->

> 🧑‍🎓 **Beginner Issue** — a well-scoped task for contributors ready to learn this codebase and own a small implementation.
> **Time:** ~8 hours · **Prerequisites:** ~1 completed [Good First Issue](https://github.com/hiero-hackers/sdk-automations/issues?q=is%3Aissue+state%3Aopen+no%3Aassignee+label%3A%22good+first+issue%22) recommended; comfortable forking, branching, and opening a PR without a tutorial.
> If that feels unfamiliar, a Good First Issue is the more rewarding path right now — you can always come back.

## The task

<!-- ✍️ Author: this is the only section you write. Unlike a Good First Issue, give
     the shape of the work, not the steps — the contributor researches and designs
     the approach, and that research is most of the value at this level. -->

**Why We Need Help:**
<!-- ✍️ Author: in 1-2 sentences summarize the problem, its magnitude or impact, and point to the relevant part of the codebase -->

**What Solution We Require:**
<!-- ✍️ Author: in 1 sentence summarize what help we need to solve this problem (the task). Be clear and direct -->

**High-Level Implementation:**
<!-- ✍️ Author: about 3 high-level steps — the shape of the work, not instructions. No file-by-file walkthrough: the contributor is expected to research the codebase and design the correct approach themselves -->

**Where to Look First:**
<!-- ✍️ Author: name 2-3 files, and one existing pattern in the codebase worth studying before coding -->

## How to work on this

1. **Claim it:** comment `/assign` on the issue and wait to be assigned before opening a PR.
2. **Get oriented:** read [ground rules](https://github.com/hiero-hackers/sdk-automations/blob/main/CONTRIBUTING.md#ground-rules-for-changes) and [signing requirements](https://github.com/hiero-ledger/sdk-collaboration-hub/blob/main/guides/issue-progression/for-developers/signing.md)
3. **Research, design, then solve it:** read the files above and their tests, work out the approach yourself, then follow the formatting and test requirements in the [contributor guide](https://github.com/hiero-hackers/sdk-automations/blob/main/CONTRIBUTING.md). AI assistance is welcome within the [AI policy](https://github.com/hiero-hackers/sdk-automations/blob/main/AI_POLICY.md); purely AI generated PRs are not accepted.

**Before opening your PR:**

- [ ] I read the relevant code and its tests before writing any
- [ ] I worked out the approach myself and am prepared to defend it
- [ ] The implementation works and follows the surrounding patterns
- [ ] I added tests for what I changed, following the package's existing test layout
- [ ] My changes stay within the scope of this issue
- [ ] The PR description links this issue with `Closes #<number>`
- [ ] `pnpm -r test` and `pnpm lint` pass
- [ ] My commits are signed off for DCO: `git commit -s -m "fix: description"`

**Stuck?** Comment here with what you have tried. A maintainer will respond.

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

<!-- ✍️ Author: this is the only section you write. State the problem and the
     expected outcome, and point at the files and one or two similar patterns in
     the codebase worth studying first. Leave implementation decisions to the
     contributor. -->

**Problem:**

**What done looks like:**

**Where to look first:** `checks/`, `docs/`, or the package named in the issue — and study a similar existing pattern before coding.

## How to work on this

1. **Claim it:** comment on the issue and wait to be assigned before opening a PR.
2. **Research before coding:** read the files above and their tests; most of the value of this level is building an accurate picture before changing anything.
3. **Set up and solve it** with `pnpm install` and `pnpm -r test`. The [contributor guide](https://github.com/hiero-hackers/sdk-automations/blob/main/CONTRIBUTING.md) has the details.

**Before opening your PR:**

- [ ] I spent real time reading the relevant code before writing any
- [ ] The implementation works and follows the surrounding patterns
- [ ] I added basic tests for what I changed, following the package's existing test layout
- [ ] `pnpm -r test` passes; scope is limited to this issue
- [ ] The basics from your first issue still apply — signed commits, linked issue, clean history

**Stuck?** Comment here with what you have tried. See the [contributor guide](https://github.com/hiero-hackers/sdk-automations/blob/main/CONTRIBUTING.md) for setup and expectations.

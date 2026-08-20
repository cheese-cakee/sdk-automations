# Candidate Hiero Contribution Workflow Profile

> **Implemented as the current candidate profile, not ratified as universal policy** —
> `packages/core/src/workflow/transitions.ts`. Every edge in the diagrams below is held equal to
> `PROFILE_EDGES` by `packages/dev/checks/test/doc-drift.test.ts`.

> This document records one possible workflow profile derived from the current C++ and Python automation.
> It is not the universal state model of the GitHub App. Maintainers must review the profile, and each
> repository must choose whether to use it.

## 1. Why this is a profile

The audited repositories do not use one shared workflow. The C++ and Python SDKs automate contribution
lifecycles in different ways, while the JavaScript SDK uses no automated lifecycle labels at all.

The App therefore needs stable platform interfaces and repository mappings rather than one mandatory label
set. A repository that wants the current Hiero contribution flow may select this profile as a starting point.
A repository may instead select individual capabilities with a smaller set of meanings.

## 2. Candidate internal meanings

The profile currently needs the following internal meanings.

| Meaning | Entity | Purpose |
|---|---|---|
| `awaitingTriage` | Issue | A maintainer has not finished classifying the issue. |
| `ready` | Issue | The issue is available for a contributor to claim. |
| `inProgress` | Issue | At least one contributor is assigned and working on the issue. |
| `needsReview` | Pull request | The pull request is ready for maintainer review. |
| `needsRevision` | Pull request | The contributor needs to respond to review or mechanical feedback. |
| `readyToMerge` | Pull request | The repository's review policy is satisfied. |
| `blocked` | Either | A maintainer has paused automation for the item. |

These names are internal identifiers. They are not required GitHub label strings.

Two facts about an item are deliberately **not** meanings, because the App reads them from GitHub's own
fields and never writes them as labels: whether the item is **closed** and, if so, **why**. Closure is
recorded as a reason — `merged` (a pull request's `merged_at` is set), `closedByHuman`, or
`completedByLinkedMerge` (an issue closed by a linked pull request merging) — alongside the position,
never instead of it. See §5.1. Modelling them as meanings would make them mappable, and a merged pull
request that still carries `status: needs review` would read as two positions and therefore as a
conflict, which would silence observation on exactly the items most worth reporting on.

## 3. Example Hiero mappings

The following mappings preserve the current C++ spelling and are useful defaults for repositories that want
the full profile. The profile includes `blocked` as an expected meaning with `status: blocked` as its default
label.

| Meaning | Example label |
|---|---|
| `awaitingTriage` | `status: awaiting triage` |
| `ready` | `status: ready for dev` |
| `inProgress` | `status: in progress` |
| `needsReview` | `status: needs review` |
| `needsRevision` | `status: needs revision` |
| `readyToMerge` | `status: ready to merge` |
| `blocked` | `status: blocked` |

The configuration validator must confirm mappings before activation. The App removes only the exact mapped
label that an approved operation owns. It never removes every label whose name begins with `status:`.

A repository may explicitly map the internal `blocked` meaning to an existing label, but it cannot replace
that meaning with a different policy concept or ask normal event processing to create an arbitrary new
label.

## 4. Candidate issue flow

```mermaid
stateDiagram-v2
    [*] --> awaitingTriage: A new issue is observed and intake is enabled.
    awaitingTriage --> ready: A maintainer completes triage.
    ready --> inProgress: A contributor is assigned.
    inProgress --> ready: The last contributor unassigns or an approved reclaim completes.
    awaitingTriage --> [*]: A human closes the issue.
    ready --> [*]: A human closes the issue or a linked merge completes it.
    inProgress --> [*]: A human closes the issue or a linked merge completes it.
```

This state diagram describes the candidate Hiero profile. A repository that enables assignment without
intake may map or create `ready` manually. A repository that does not enable contribution assignment does not
need the issue flow at all.

The assignment capability must keep the assignee state and the mapped workflow meaning consistent. The exact
behavior for multiple assignees remains a policy question for the assignment specification.

## 5. Candidate pull request flow

```mermaid
stateDiagram-v2
    [*] --> needsReview: Enabled checks pass.
    [*] --> needsRevision: An enabled check fails.
    needsReview --> needsRevision: A check fails or a review requests changes.
    needsRevision --> needsReview: New evidence shows that the problem is resolved.
    needsReview --> readyToMerge: The repository's review policy is satisfied.
    readyToMerge --> needsReview: The approval stops counting.
    readyToMerge --> needsRevision: A check fails after approval.
    needsReview --> [*]: The pull request merges or a person closes it.
    needsRevision --> [*]: The pull request merges or a person closes it.
    readyToMerge --> [*]: The pull request merges or a person closes it.
```

The repository may choose a smaller policy. For example, a repository may enable a pull request dashboard
without mapping or writing any workflow label.

Three arrows above were corrected on 2026-07-29 after the tables were read against the audit; the register
records them as D48.

- **`readyToMerge → needsRevision` was missing entirely.** An approved pull request whose checks break had
  no path to `needsRevision`, so the only way out asserted that new commits had arrived. Checks break with
  no push at all: the audited Sibling Conflict Re-check re-reads every open pull request's `mergeable`
  state whenever a *different* pull request merges, and swaps its status label
  (`design/audit/services-cpp.md`).
- **`needsReview → needsRevision` needs a review cause, not only a failing check.** The audited PR Review
  Label Applicator performs exactly this move on a `changes_requested` review. Observing it requires the
  `pull_request_review` subscription the App currently lacks (experiment 6.6), so the cause exists in the
  profile before the subscription that feeds it.
- **`readyToMerge → needsReview` is caused by the approval no longer counting**, not specifically by new
  commits. Dismissal, withdrawal, and a changed base all produce it; naming the trigger instead of the
  consequence made those unexpressible.

### 5.1 Closure and reopening

Closing is not a position and reopening is not a transition.

Closing records **why** (§2: `merged`, `closedByHuman`, `completedByLinkedMerge`) and leaves every position
label untouched, because the App does not clean up labels on close — see
[`../guides/manual-edits.md`](../guides/manual-edits.md) §3 and the
`status:*` strip that the audit found removing human-set `status: blocked` labels as a side effect
(`design/audit/labels-cpp.md`). Downstream policy needs the reason: contributor progression credits a merged
linked pull request and not an abandoned one (`design/guides/capabilities/progression.md`), and the audited post-merge
cleanup is gated on `merged == true`.

Reopening therefore **clears the closure and restores nothing else** — the position labels were never
removed, so the item comes back exactly where it was. One invariant falls out of the reason: a **merged
pull request can never reopen**, which GitHub enforces and the profile refuses rather than omits.

An automation-initiated close has no cause or operation of its own yet. It must not borrow
`closedByHuman`; adding such an operation requires its own catalogue and destructive-safety review. The
current inactivity probe can only request a comment or unassignment and cannot close an item.

## 6. Issue and pull request links

A pull request and an issue remain separate GitHub entities. A capability must declare when it reads across
their link and which link mechanism it uses.

Closing references are the candidate default for Hiero because they match GitHub's native close-on-merge
behavior. The App does not write an issue label merely because a linked pull request changed state. A
cross-entity write requires a separate declared operation and maintainer approval.

## 7. Human edits

Human changes remain authoritative unless an explicitly approved policy says otherwise. The platform reads
the current state before a write and refuses an operation when a newer human change invalidates its
precondition.

The profile may provide coherence checks for repositories that want a single mapped position. Those checks
must not touch unrelated labels or force a repository to adopt the full profile. The detailed candidate
behavior is recorded in [`../guides/manual-edits.md`](../guides/manual-edits.md) and remains subject to
profile ratification.

## 8. Optional skill policy

A skill ladder is not part of the universal platform taxonomy. It is an optional assignment policy used by
some Hiero repositories.

The existing audit found the following candidate rungs.

| Internal rung | Example label |
|---|---|
| `goodFirstIssue` | `skill: good first issue` |
| `beginner` | `skill: beginner` |
| `intermediate` | `skill: intermediate` |
| `advanced` | `skill: advanced` |

Repositories that enable the policy must decide the rung mappings, prerequisite counts, completion rules,
and whether credit is repository-local or organization-wide. Repositories that do not enable it do not need
these labels or contribution-history queries.

## 9. Native fields and other representations

Priority, effort, review queue, and other facts should use GitHub-native fields when those fields meet the
repository's needs and the required permissions are acceptable. A resolver may hide the representation from
capabilities, but the repository still chooses and configures the authoritative source.

The App does not copy arbitrary issue labels onto pull requests. It does not create a shared namespace unless
an enabled profile requires and validates that namespace.

## 10. Questions that remain open

- Maintainers must decide which repositories want this profile and which want smaller capability sets.
- The current meanings are closed in core; stage-four review must decide whether a first real capability
  justifies keeping all of them in the platform catalogue.
- Syntactic and injective mapping validation is built. Required-meaning declarations, live label-existence
  checks, and mapping migration remain open.
- Assignment maintainers must decide the multiple-assignee behavior.
- Review maintainers must decide whether `readyToMerge` is stored or derived. This is the largest open
  lever in §5: if it is derived from approval count, check status, and policy, it is a projection rather
  than a position, and most of §5's edges collapse into that derivation. The D48 corrections above assume
  it is stored, which is the weaker assumption — they are wasted work if the answer is "derived", not
  wrong work.
- The first version has no operation or cause for an automation-initiated close (§5.1); a future capability
  must add both through catalogue and safety review.
- Repositories that want a skill ladder must decide its scope and completion policy.
- The first version requires repositories to provision mapped labels. A later explicit setup operation may
  be considered separately.

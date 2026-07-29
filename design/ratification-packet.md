# Stage-Four Ratification Packet

> Working material, prepared 2026-07-25. This packet collates every register row awaiting ratification
> into per-venue agendas so stage four ("Ratify the minimum architecture") is a set of answerable
> questions, not a re-read of the whole register. Ratification itself is still recorded only in
> [`decisions.md`](decisions.md) §5 — approving names, date, evidence. Each row below carries the
> **recommended answer** (what the implementation packages encode today) and the named alternative;
> a reviewer's job per row is *accept* or *change*, with changes flowing back to code and register.

## 0. Phase outcome — 2026-07-25

The engineering rows were **adopted as working architecture** (see the adoption record in
[`decisions.md`](decisions.md) §3): the storage/recovery agenda's recommended answers including the
working values (15-minute lease, 2× requeue threshold, 90-day retention, 5-attempt bound, operator-action
close-out, the D46 gate on `active`), D29/D33 as encoded, and D40 at quarterly cadence. Those rows moved
`hypothesis → supported`; formal `ratified` still requires the stage-four review.

**Still open, and now the packet's whole remaining job:** the seven maintainer-taste rows — D28, D30, D31,
D34, D35, D38, D39 — carried into the stage-two conversations via §7, plus D39's security-control
sub-question (D22) and the formal stage-four close-out of the storage trio.

## 1. Scope

Covered: the implementation-born hypotheses D28–D46, the audit-born workflow rows D47–D49 (added
2026-07-29, after §0's adoption record and therefore not covered by it), and the storage decision's
pending closures (D1, D13, D24, D27, Q15). Not covered (§8): earlier hypotheses that wait on capability
selection, not on architecture review, and D50 plus D51–D53 and D55–D59, which are defect repairs or
mechanical hardening carrying no maintainer choice. D54 (the unimplemented `immediatePreventive` gate) is
covered in §4.

Evidence base shared by every row: the stage-three experiment records (6.1–6.6, 2026-07-23), and the
three implementation packages with 294 deterministic tests — including the exhaustive safety sweep,
the projection enumeration, and the executor crash grid (every reachable perform crash, 64 scheduled
two-point histories, and seeded multi-crash histories). The grid proves serialized crash-and-restart
convergence under its consistent fake; it does not prove live lease takeover is safe.

## 2. Storage and recovery agenda

**Venue:** the stage-four architecture review. **Evidence:** experiments 6.2/6.4/6.5;
[`storage-decision.md`](operations/storage-decision.md); `store/` and `executor/` with their crash
and interleaving suites.

| Row | Decision to confirm | The question for reviewers | Recommended answer |
|---|---|---|---|
| D1, D13, D24, D27, Q15 | Close the storage decision: four-table single-file SQLite store; GitHub keeps outcomes; markers are identity/receipt, not state. | Does the 6.5 evidence plus the automated crash grid satisfy §5's ratification rule? | Close all four as the storage decision states; record names and date. |
| D41 | Claims are leases with atomic stale takeover; `release` on completion. | Accept lease semantics, and **set the lease duration** (must exceed the longest plausible effect). | Accept; propose 15 minutes as the starting lease, revisited when the first capability's longest effect is measured. |
| D42 | Journal rows carry a durable `attempt` counter; `done` rows are immutable to `intent`. | Accept the one-column amendment to the decided schema? | Accept — it implements the grid's own "bounded history" cell. |
| D43 | The sweep API: `claimed_at`, `requeueStuck`, `openIntents`. | Accept the amendment, and **set the requeue threshold and retention windows** (`seen_delivery`, done journal rows). | Accept; propose requeue threshold = 2× lease; retention 90 days for both tables pending an audit-obligation check. |
| D44 | `MAX_CALL_ATTEMPTS = 5` — a call re-sent five times surfaces to the operator. | Confirm the bound value. | Accept 5; any value ≥ 2 preserves the property, the exact number is operator taste. |
| D46 | Exactly-once is proven **relative to a consistent read-back**; real GitHub reads lag writes. | Accept the stated precondition, and commission the stage-five staleness measurement (starting with list-comments after create-comment). | Accept; the row cannot ratify until the measurement exists — the ask today is agreeing it gates `active` mode. |

## 3. Workflow-profile agenda

**Venue:** the D6/D8 manual-edit scenario review, fed by the stage-two maintainer conversations.
**Evidence:** `core/src/taxonomy.ts`, `core/src/observe.ts`, the projection enumeration (all 128
meaning subsets).

| Row | Decision to confirm | The question for reviewers | Recommended answer |
|---|---|---|---|
| D28 | `blocked` is an orthogonal pause flag — an item keeps its position while blocked. | Flag, or a position that forgets the previous state? | Flag: unblocking restores the item exactly, which matches how maintainers use blocking labels today. |
| D29 | Manual label placement is observed reality to reconcile, never a requestable transition. | May a capability ever *request* a jump the diagrams omit? | No — capabilities move along documented edges; humans may land anywhere. |
| D35 | The projection's three readings: other-flow meanings ignored-and-reported; `blocked` alone is "no position, paused"; closed items keep positions unrepaired. | Are cross-entity labels noise to preserve, or incoherence to conflict on? | Noise to preserve (reported for diagnostics); rides with D28 for the blocked reading. |
| D47 | Closure is a recorded reason (`merged` / `closedByHuman` / `completedByLinkedMerge`), orthogonal to position, read from GitHub and never written. | Accept the three reasons as sufficient for the first version? | Accept — progression and the audited post-merge cleanup both branch on `merged`, so the distinction is already load-bearing. A fourth value for automation-initiated closes waits for the inactivity capability that needs it. |
| D48 | Three pull-request flow corrections: the missing `readyToMerge → needsRevision` edge, the added `reviewRequestedChanges` cause, and `approvalInvalidated` replacing `newCommitsInvalidatedApproval`. | Do the audited C++ behaviors (Sibling Conflict Re-check, PR Review Label Applicator) belong in the profile? And **answer §10's stored-vs-derived question for `readyToMerge` first** — if derived, all three collapse. | Accept all three as the stored-position reading, conditional on the stored-vs-derived answer. The `reviewRequestedChanges` cause also needs the `pull_request_review` subscription (6.6 gap) before anything can observe it. |
| D49 | Reopening clears the closure and restores the prior position; a merged pull request can never reopen. | Should a reopened item resume where it was, or re-enter triage? | Resume — the position labels were never removed, so resuming is the no-surprise reading. A repository whose triage is the entry gate may want re-entry; that is a profile option, not a platform default. |

## 4. Safety-policy agenda

**Venue:** maintainer review attached to D10 (destructive actions), D7 (human-edit precedence), and
D22 (kill switches). **Evidence:** `core/src/safety.ts`, the 384-context sweep, boundary tests.

| Row | Decision to confirm | The question for reviewers | Recommended answer |
|---|---|---|---|
| D30 | Grace periods have a 1-day floor. | Is one day the right minimum for the first destructive capability? | Keep 1 day as the *schema* floor; individual capabilities may demand more. |
| D33 | Human-edit ties go to the human (`>=`); the causing event is excluded from the comparison. | Accept the tie-break and the exclusion rule? | Accept — GitHub timestamps are second-granularity, ties are real, and the human should win them. |
| D54 | `immediatePreventive` has no dedicated gate and is currently evaluated as a reversible change — weaker than safety.md §1 requires of it. | Accept that no capability may request an immediate preventive action until the class has its own gate? | Accept as a precondition on the first such capability (the `intake` moderation row in safety.md §4). The class stays in the model so the requirement is not lost; what is missing is a gate, not a decision. |
| D39 | An active kill switch refuses even pure observations. | Does "stop" stop reading too? And are operator alerts/security controls exempt (as they are from item-level blocks)? | Total stop for capabilities; **the security-control exemption is a genuine open sub-question for D22's review** — the code does not model it yet. |

## 5. Configuration agenda

**Venue:** the Q14 configuration review. **Evidence:** `core/src/config.ts`, experiment 6.3, the
adversarial and property suites.

| Row | Decision to confirm | The question for reviewers | Recommended answer |
|---|---|---|---|
| D31 | The no-config mode is `observe`. | `observe` (platform watches, reports, never writes) or `disabled` (platform inert)? | `observe` — visibility without writes is the safer onboarding default. |
| D34 | Label mappings are fully injective. | Define schema.md §3's "incompatible": full injectivity, or same-entity-only (one "attention" label shared across the issue and PR flows)? | Full injectivity, for three reasons. (1) Reversal asymmetry: relaxing later accepts previously-rejected configs (non-breaking); tightening later invalidates working configs, which fail-closed then drops to `observe` (breaking). (2) The question only concerns the seven position meanings — unmapped labels (priority, area) are already freely shared — and `blocked` shows the right mechanism for genuine cross-flow demand: a shared *meaning*, not two meanings sharing a label. (3) A GitHub label has one description and color; conditional per-entity semantics leak into every downstream consumer. The projection could technically tolerate sharing — this is a product choice, not an implementation constraint. |
| D38 | Fail-closed is whole-file; one error drops the repository to `observe`. | Is the loud full stop acceptable, given the config report and PR-time validation as required mitigations? | Accept, **conditional on the PR-time check existing before any repository runs `active`** — that condition is part of the row. |
| D45 | Stale-plan journal rows surface as unresolved, never remapped. | How is a surfaced stale effect closed out — operator action, automatic abandon after review, or re-issue under the new revision? | Operator action for the first version; automation of close-out waits for evidence it is needed. |

## 6. Operations agenda

**Venue:** the Q1/Q13 owners (hosting and operations). **Evidence:** `core/src/failures.ts`, the
observed-fixture suite.

| Row | Decision to confirm | The question for reviewers | Recommended answer |
|---|---|---|---|
| D40 | Failure classification is snapshot evidence; rot degrades into `forbiddenUnrecognized`. | Set the sandbox re-probe cadence and name the fixture-refresh owner. | Quarterly re-probe, plus ad-hoc when `forbiddenUnrecognized` reports rise; owner falls out of Q13's naming. |

## 7. Questions to carry into stage two (1–7 August), in maintainer language

The rows above that are taste, not engineering — phrased for the conversations, mapped back to rows:

1. "When you mark an issue **blocked** and later unblock it, should it remember where it was?" → D28, D35
2. "If automation and a maintainer act on the same item at the same second, who should win?" → D33
3. Ask for their label sheet, not a preference: "show me the labels you apply to both issues and PRs
   today." Classify each — non-position (already fine, unmapped), blocked-like (already a shared
   meaning), or genuinely two different positions under one name. Only the last challenges D34, and if
   it appears, the answer is adding a shared meaning, not relaxing injectivity. → D34
4. "If your automation config file has a typo, would you rather **everything pauses loudly** until it
   is fixed, or the valid parts keep running?" → D38
5. "What is the **shortest warning period** you would accept before automation does anything
   destructive (like unassigning for inactivity)?" → D30
6. "When someone pulls the emergency stop, should the App also stop **watching and recording**, or
   only stop acting?" → D39
7. "When automation cannot finish something safely, is a **surfaced 'needs a human'** acceptable, or
   must it always resolve on its own?" → D44, D45
8. "When a pull request is **closed without merging**, should the contributor's work count the same as a
   merge — for credit, for recommendations, for anything?" → D47
9. "When you **reopen** a closed issue, should it come back where it was, or go back to triage?" → D49
10. "Is `ready to merge` something you want the App to **write as a label**, or is it just a **view** of
    'approvals satisfied and checks green'?" → the §10 stored-vs-derived question, which gates D48. Ask
    this one first: a "view" answer removes most of the pull-request flow's edges rather than correcting
    them.

## 8. Not in this packet

Waiting on capability selection or later stages, unchanged by this review: D2, D5, D6, D11, D14, D15,
D23, D25 (hypotheses tied to the first capabilities), D16 (reopened — optional skill ladder). D32 and
the `supported` rows need no action. D8, D36, D37 are `replaced` tombstones.

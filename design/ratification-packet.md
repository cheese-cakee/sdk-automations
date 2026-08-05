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

**Amended 2026-08-05.** The sentence above is no longer complete: §2b and §2c add fifteen engineering rows
(D61–D75) that postdate the adoption record and have never been reviewed. They are not maintainer taste
— they are architecture, and two of them are safety rows — so they belong to the stage-four session, not
the stage-two conversations. Only D69 reaches into §7, as a gate on the first-capability choice.

## 1. Scope

Covered: the implementation-born hypotheses D28–D46, the audit-born workflow rows D47–D49 (added
2026-07-29, after §0's adoption record and therefore not covered by it), and the storage decision's
pending closures (D1, D13, D24, D27, Q15). Not covered (§8): earlier hypotheses that wait on capability
selection, not on architecture review, and D50 plus D51–D53 and D55–D60, which are defect repairs or
mechanical hardening carrying no maintainer choice. D54 (the unimplemented `immediatePreventive` gate) is
covered in §4.

The seam-born rows D61–D73 (added 2026-08-05) are covered, in §2b; the cross-cutting simplification
rows D73–D75 are covered in §2c. They are listed separately from the
2026-07-30 audit rows because they are not the same kind of thing: those were defect repairs inside
`core/`, these are boundary decisions between packages, and two of them (D62, D64) change how the storage
decision's retry and destructive rules are fed.

Evidence base shared by every row: the stage-three experiment records (6.1–6.6, 2026-07-23), and the
four implementation packages with 331 deterministic tests — including the exhaustive safety sweep,
the projection enumeration, the executor crash grid (every reachable perform crash, 64 scheduled
two-point histories, and seeded multi-crash histories), and the capability toggle matrix. The grid
proves serialized crash-and-restart convergence under its consistent fake; it does not prove live
lease takeover is safe.

## 2. Storage and recovery agenda

**Venue:** the stage-four architecture review. **Evidence:** experiments 6.2/6.4/6.5;
[`storage-decision.md`](operations/storage-decision.md); `store/` and `executor/` with their crash
and interleaving suites.

| Row | Decision to confirm | The question for reviewers | Recommended answer |
|---|---|---|---|
| D1, D13, D24, D27, Q15 | Close the storage decision: four-table single-file SQLite store; GitHub keeps outcomes; markers are identity/receipt, not state. | Does the 6.5 evidence plus the automated crash grid satisfy §5's ratification rule? | Close all four as the storage decision states; record names and date. |
| D41 | Claims are leases with atomic stale takeover; `release` on completion. **Reframed 2026-08-05** — see the note below the table. | Accept lease semantics, accept the stated PRECONDITION, and agree that the row gates `active` mode. | Accept as a precondition, not a closure. 15 minutes remains the working lease, revisited when the first capability's longest effect is measured. |
| D42 | Journal rows carry a durable `attempt` counter; `done` rows are immutable to `intent`. | Accept the one-column amendment to the decided schema? | Accept — it implements the grid's own "bounded history" cell. |
| D43 | The sweep API: `claimed_at`, `requeueStuck`, `openIntents`. | Accept the amendment, and **set the requeue threshold and retention windows** (`seen_delivery`, done journal rows). | Accept; propose requeue threshold = 2× lease; retention 90 days for both tables pending an audit-obligation check. |
| D44 | `MAX_CALL_ATTEMPTS = 5` — a call re-sent five times surfaces to the operator. | Confirm the bound value. | Accept 5; any value ≥ 2 preserves the property, the exact number is operator taste. |
| D46 | Exactly-once is proven **relative to a consistent read-back**; real GitHub reads lag writes. | Accept the stated precondition, and commission the stage-five staleness measurement (starting with list-comments after create-comment). | Accept; the row cannot ratify until the measurement exists — the ask today is agreeing it gates `active` mode. |

**D41, reframed (2026-08-05).** The row asks for "renewal and adapter deadlines shorter than the lease" and
"takeover delayed beyond the maximum in-flight lifetime" — every one of those is a property of an adapter
that does not exist, so the row cannot close at this review however long it is discussed. It is also not a
blocker for the storage decision above: D41 concerns the executor's claim SEMANTICS, not the four-table
schema, and the grid's crash-and-restart results are unaffected by it.

The ask is therefore the same shape D46 already established and this project already accepted: **state the
precondition, commission the measurement, gate `active` mode.** Exactly-once holds under single-worker
execution; live overlap is fenced by a contract whose parameters are measured at stage five alongside the
adapter; `observe` and `dry-run` are unaffected, because D68 stops those at planning and nothing is ever
journalled. A deterministic overlapping-worker oracle remains required — built with the adapter it tests,
rather than against numbers that would have to be invented today.


## 2b. Capability-boundary and seam agenda

**Venue:** the stage-four architecture review, alongside §2 — same session, because two of these rows
change how the storage decision's retry rules are fed. **Evidence:** `core/src/capability/`,
`executor/src/planner.ts`, and the three disposable probe capabilities with their boundary, toggle-matrix,
and composition suites (`probes/`, 29 tests).

Numbered `2b` deliberately: the packet's later section numbers are referenced from `decisions.md` and
`planning/stage-four-review-packet.md`, so renumbering would break citations for no gain.

These rows come from a source the packet did not previously have — building the seam BETWEEN the
finished packages rather than any one of them. Each package was individually correct and individually
tested, which is exactly why these gaps were invisible until a capability decision was
carried through to an effect for the first time.

**Three of them are safety rows and should be read first (D62, D64, D73).** Both are cases where the safety
engine and the capability contract were written against each other and did not meet.

| Row | Decision to confirm | The question for reviewers | Recommended answer |
|---|---|---|---|
| **D62** | The platform owns an operation's idempotency class; a capability's declaration is a redundant statement that must match, checked at registry build. | Accept that the catalogue, not the declaration, is authoritative? | **Accept.** The alternative is already demonstrated harm: a capability declaring `postManagedComment` as `idempotent` routes a lost response down the blind-retry path and reproduces 6.5's comment duplication. Fold `checkAgainstCatalogue` into the platform's registry build so no shipped declaration can skip it. |
| **D64** | A destructive intent carries its own warning record; a warning on a non-destructive intent is an error. | Accept the warning riding on the intent rather than being fetched by the planner? | **Accept.** The capability decides an item is stale, so it must show its warning; a planner that looked the record up could pair a warning with an intent that was never about it. The reverse check matters more — a warning on a non-destructive intent reads as a grace period no gate will consult. |
| D61 | Observations, resolvers, and intents are closed platform catalogues; capabilities choose from them and cannot extend them. | Is the catalogue the right closure point? This answers contract.md §9's first open question. | Accept. Per-capability intent shapes are unimplementable at the adapter, which would need an executor for a type it has never seen. A capability needing a new operation extends the catalogue by review — the intended cost, not a workaround. |
| D63 | `ActionClass` enters through the intent, with a per-operation floor; stricter is allowed, laxer refused. | Confirm the floor value for each catalogue operation. | Accept the mechanism; the encoded floors are the weakest defensible reading, in the same spirit as `MIN_GRACE_DAYS`. Review is confirming numbers, not design. |
| D65 | One derivation for `idempotencyKey`: capability, repository, item, operation, and the dated cause — deliberately not the desired payload. | Is the cause timestamp the right occasion boundary? | Accept. Flagged risk: a capability whose cause is not event-shaped (a sweep with no per-item event) may need a different occasion key. `inactivity` is the first candidate that would hit this. |
| D66 | One intent produces one plan. | Accept independent plans over grouped ones? | Accept. Grouping can be added later; ungrouping a shared plan after the fact cannot. No candidate capability needs atomic multi-effect ordering. |
| D67 | The reviewed configuration's mode is authoritative; a planner whose rechecked context disagrees refuses rather than picking a winner. | Accept refusal over silent override? | **Accept**, and make it a stage-five shell requirement: the context's mode is sourced from `parseConfig` output and nowhere else. Found by a failing test, not by reasoning — before the guard, a `dry-run` repository produced an `active` plan and every test passed. |
| D68 | Dry-run and observe stop at planning, before a plan exists. | Accept that rule 10 is a planning decision, not an execution one? | Accept. A journalled plan for a write that will never be attempted becomes an open intent the recovery loop must resolve — manufactured operator work out of a mode whose promise is that nothing happens. |
| D69 | The single declared idempotency class holds only while every operation is single-call. | No decision today — **a gate on §7's first-capability choice.** | If the ratified capability has any multi-call effect, resolve this before the effect is built: the class moves from the intent declaration onto the call, or plans retry under the wrong rule. |
| D70 | P3 is now tested in code: all eight subsets of three dissimilar capabilities, with a negative control. | Does this discharge build-plan §12's post-November commitment? | Accept as discharging the *principle*; the post-November work becomes substituting the first ratified capability for its probe and re-running the matrix — a substitution, not a workstream. |
| D71 | A capability sees which meanings are mapped, never the repository's label strings. | Is availability-only enough for a capability that wants to explain itself in the repository's own words? | Accept the projection. The managed comment is rendered by the platform, which does have the mapping — so the capability never needs the string. |

| D72 | A destructive warning is rebuilt at act time from the stored warned cause, never from the current request. | Is plain-data persistence plus rebuild the intended reading of D60, or a weakening of it? | Accept as the intended reading. The brand is a within-process guarantee; the store is the trust boundary. Rebuilding from the current request would make D60's snapshot check compare a value with itself — the tempting fix and the one that voids the row. |

| **D73** | `WriteContext.capabilityEnabled` duplicates `CapabilityConfig.enabled` with no comparison between them. | Close it with a fifth guard, or by deriving `WriteContext` from the configuration entirely? | **Derive.** A shell can assert consent for a capability the reviewed config disables, and D53's name check passes because the names match. A fifth comparison closes this one instance; the derivation retires D53's and D67's guards too and makes the state unrepresentable. Until it lands, `capabilityEnabled` must come from `parseConfig` output and nowhere else. |

**What this agenda does not settle.** Nothing here touches GitHub: the composition suite fakes the port
with the same declared read-after-write kindness as the crash grid (D46), and its crash test restarts a
dead process rather than racing a live one — so **D41 remains untouched and still `reopened`**.

## 2c. Core simplification agenda

**Venue:** the stage-four architecture review, after §2 and §2b. **Evidence:** a cross-cutting read of
`core/` on 2026-08-05, recorded as D73, D74 and D75. **D73 is implemented and in the branch; D74 and D75
are proposals.** The review's job on D73 is therefore confirm-or-revert, which is the same standing every
other implemented-but-unratified row in this register already has.

Three proposals that share one shape, and one reason for being asked NOW rather than after the review.

The shape: each is a place where every individual choice is locally defensible and the aggregate costs
something at every seam. None is a defect — the code is correct today. They are the difference between a
package a maintainer can hold in their head and one they cannot.

The reason for asking first: **two of them retire rows this same review is being asked to ratify.**
Proposal 1 deletes D53's and D67's guards. Ratifying those guards and then unpicking them a month later
wastes the review's own decision, so the choice belongs here, in front of the people making it.

| Row | Proposal | The question for reviewers | Recommended answer |
|---|---|---|---|
| **D73** | Derive `WriteContext` from the reviewed configuration and the request, instead of assembling it by hand. **Implemented 2026-08-05**; D53 and D67 are marked `replaced`. | Confirm the derivation, or revert to guards? | **Confirm.** The same fact stored twice, free to disagree, had been patched three times — D53 (capability name), D62 (idempotency class), D67 (mode) — and the fourth, consent itself, was never patched at all: a shell could assert `capabilityEnabled: true` for a capability the reviewed file disabled, and D53's check passed because the *names* matched. `evaluateWrite(request, config, facts)` now reads mode, enablement and capability from the two things the caller already holds. Two refusal codes, two guards and two tests were deleted, and the exhaustive safety sweep lost a whole dimension — it had been enumerating a state the types no longer permit. |
| **D74** | One internal instant representation — epoch milliseconds — converted only at GitHub-in and SQLite-out. | Accept a single representation, and delete the store's defensive timestamp validator? | **Accept.** Three encodings cross one seam today (`Date`, `…Ms` numbers, canonical ISO strings), and the store validates format precisely because it cannot trust what it is handed. Milliseconds satisfy D60's immutability requirement by type instead of by convention. |
| **D75** | One failure discriminant, and a machine-readable `code` on configuration errors. | Is prose-only configuration error reporting acceptable, given that D38 rests on the config report and the PR-time check? | **Not acceptable — add codes.** D38's fail-closed granularity was accepted *conditional on those two mitigations*, and both can currently only echo strings, because configuration errors carry no code to group, count or link by. Every other refusal in core has one. The prose stays prose: assert `reason` is present, never its wording. |

**What a "no" costs, stated plainly.** Nothing breaks. The code is correct as it stands, and every row can
be deferred to a later simplification pass. The only irreversible part is Proposal 1: if D53's and D67's
guards are *ratified* rather than deferred, retiring them later reopens ratified rows, which §5 makes
deliberately expensive. A reviewer who wants more time should defer those two rows rather than ratify them.

**What none of these are.** They are not the capability ranking, they touch no maintainer policy, and they
change no behaviour a repository could observe. A reviewer with no opinion can safely say "defer" to all
three.

## 3. Workflow-profile agenda

**Venue:** the D6/D8 manual-edit scenario review, fed by the stage-two maintainer conversations.
**Evidence:** `core/src/workflow/`, the projection enumeration (all 128
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
D22 (kill switches). **Evidence:** `core/src/safety/`, the 5,120-context sweep, boundary tests.

| Row | Decision to confirm | The question for reviewers | Recommended answer |
|---|---|---|---|
| D30 | Grace periods have a 1-day floor. | Is one day the right minimum for the first destructive capability? | Keep 1 day as the *schema* floor; individual capabilities may demand more. |
| D33 | Human-edit ties go to the human (`>=`); the causing event is excluded from the comparison. | Accept the tie-break and the exclusion rule? | Accept — GitHub timestamps are second-granularity, ties are real, and the human should win them. |
| D54 | `immediatePreventive` has no dedicated gate and therefore fails closed with `preventiveGateUnavailable`. | Accept that no capability may request an immediate preventive action until the class has its own gate? | Accept as a precondition on the first such capability (the `intake` moderation row in safety.md §4). The class stays in the model, but cannot apply under weaker reversible-change rules. |
| D39 | An active kill switch refuses even pure observations. | Does "stop" stop reading too? And are operator alerts/security controls exempt (as they are from item-level blocks)? | Total stop for capabilities; **the security-control exemption is a genuine open sub-question for D22's review** — the code does not model it yet. |

## 5. Configuration agenda

**Venue:** the Q14 configuration review. **Evidence:** `core/src/config/`, experiment 6.3, the
adversarial and property suites.

| Row | Decision to confirm | The question for reviewers | Recommended answer |
|---|---|---|---|
| D31 | The no-config mode is `observe`. | `observe` (platform watches, reports, never writes) or `disabled` (platform inert)? | `observe` — visibility without writes is the safer onboarding default. |
| D34 | Label mappings are fully injective. | Define schema.md §3's "incompatible": full injectivity, or same-entity-only (one "attention" label shared across the issue and PR flows)? | Full injectivity, for three reasons. (1) Reversal asymmetry: relaxing later accepts previously-rejected configs (non-breaking); tightening later invalidates working configs, which fail-closed then drops to `observe` (breaking). (2) The question only concerns the seven position meanings — unmapped labels (priority, area) are already freely shared — and `blocked` shows the right mechanism for genuine cross-flow demand: a shared *meaning*, not two meanings sharing a label. (3) A GitHub label has one description and color; conditional per-entity semantics leak into every downstream consumer. The projection could technically tolerate sharing — this is a product choice, not an implementation constraint. |
| D38 | Fail-closed is whole-file; one error drops the repository to `observe`. | Is the loud full stop acceptable, given the config report and PR-time validation as required mitigations? | Accept, **conditional on the PR-time check existing before any repository runs `active`** — that condition is part of the row. |
| D45 | Stale-plan journal rows surface as unresolved, never remapped. | How is a surfaced stale effect closed out — operator action, automatic abandon after review, or re-issue under the new revision? | Operator action for the first version; automation of close-out waits for evidence it is needed. |

## 6. Operations agenda

**Venue:** the Q1/Q13 owners (hosting and operations). **Evidence:** `core/src/github/failures.ts`, the
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

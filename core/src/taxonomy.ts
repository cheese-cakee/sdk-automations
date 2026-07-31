/**
 * The candidate Hiero workflow profile as executable logic —
 * `design/core/taxonomy.md` §2, §4, §5, §6 turned into transition tables.
 *
 * These are internal meanings, not GitHub label strings; repositories map
 * them via configuration (`design/config/schema.md` §3). The tables below
 * encode exactly the two state diagrams in the design doc — where the doc
 * was ambiguous, the choice is recorded in a comment tagged FINDING and
 * belongs in the decision register. `test/doc-drift.test.ts` compares the
 * tables against the doc's diagrams so the two cannot silently diverge.
 *
 * **This module is the CAPABILITY rulebook only.** `manual-edits.md` §1 and
 * D29 give humans and capabilities different rules: a capability may move
 * only along a documented edge, while a person with repository permission
 * may land an item anywhere. So there is deliberately no human rulebook
 * here — the human path is `observe.ts`, which reconciles whatever labels
 * a person left rather than validating them, and `safety.ts` rule 5, which
 * decides precedence when a human change and a capability request collide.
 * Routing a human edit through `applyTransition` would produce a
 * `noSuchEdge` refusal for a perfectly legal human action; nothing in the
 * types prevents that yet (the request carries no actor), so it stays a
 * shell obligation.
 *
 * What this module DOES see of human activity is one thing: divergence.
 * The `stalePrecondition` guard refuses when the item is not where the
 * request assumed, whoever moved it. It compares positions only — a human
 * change that leaves the position alone (unassigning while the item stays
 * `inProgress`) is invisible here and rides on `WriteContext`'s
 * `preconditionHolds` attestation instead.
 */

export type EntityKind = "issue" | "pullRequest";

/** Issue-flow meanings — taxonomy.md §4. */
export const ISSUE_MEANINGS = ["awaitingTriage", "ready", "inProgress"] as const;
export type IssueMeaning = (typeof ISSUE_MEANINGS)[number];

/** Pull-request-flow meanings — taxonomy.md §5. */
export const PR_MEANINGS = ["needsReview", "needsRevision", "readyToMerge"] as const;
export type PrMeaning = (typeof PR_MEANINGS)[number];

/**
 * Why an item is closed, as GitHub reports it (`merged_at`,
 * `state_reason`) — never a mapped label, so it is observed and never
 * written. Closure is NOT a position: a closed item keeps whatever
 * position labels it carries (D35), and `merged` must be distinguishable
 * from `closedByHuman` because downstream policy branches on it —
 * progression credits only a merged linked pull request
 * (`design/modules/progression.md`), and the audited C++ post-merge
 * cleanup is gated `merged == true` (`audit/services-cpp.md`).
 *
 * FINDING(taxonomy-closure-reason), D47: taxonomy.md §5 wrote "The pull
 * request closes or merges" as ONE edge, discarding the distinction at
 * exactly the point it starts to matter. Recorded here as an orthogonal
 * fact rather than a meaning, for the same reason as `blocked` (D28).
 */
export type ClosureReason =
    /** A pull request merged — `merged_at` is set. */
    | "merged"
    /** A person closed the item; for a pull request, closed unmerged. */
    | "closedByHuman"
    /** An issue closed because a linked pull request merged. */
    | "completedByLinkedMerge";

/**
 * FINDING(taxonomy-blocked), D28: §2 lists `blocked` as a meaning, but
 * neither state diagram (§4, §5) contains it, and safety.md §5 gives it
 * pause semantics. Modelled as an orthogonal pause flag — an item keeps
 * its position while paused. If maintainers want a position instead,
 * the state type and both tables change.
 */
export interface WorkItemState<M> {
    /** Current workflow position, `null` before entry / with no mapped label. */
    readonly meaning: M | null;
    /** Orthogonal pause — see FINDING(taxonomy-blocked). */
    readonly blocked: boolean;
    /**
     * Why the item is closed, `null` while open. Closed items accept no
     * transitions; `applyReopen` is the only way back to open.
     */
    readonly closedBy: ClosureReason | null;
}

/**
 * Issue-flow causes — taxonomy.md §4. Scoped per entity so a PR cause on
 * an issue request is a COMPILE error, not a runtime `causeNotAccepted`:
 * the same "make misuse unrepresentable" rule `ids.ts` applies to
 * delivery ids.
 *
 * FINDING(taxonomy-entity-scoped-causes), D50: the first implementation
 * used one flat cause union for both flows, so `triageCompleted` on a
 * pull request type-checked and was rejected only at runtime. Splitting
 * costs nothing — no cause is legal in both flows except `humanClosed`.
 */
export const ISSUE_CAUSES = [
    "intakeObserved", // [*] → awaitingTriage
    "triageCompleted", // awaitingTriage → ready
    "contributorAssigned", // ready → inProgress
    "lastContributorUnassigned", // inProgress → ready
    "reclaimCompleted", // inProgress → ready (approved reclaim)
    "humanClosed", // any → closed
    "linkedMergeClosed", // any → closed, because a linked PR merged
] as const;
export type IssueCause = (typeof ISSUE_CAUSES)[number];

/** Pull-request-flow causes — taxonomy.md §5. */
export const PR_CAUSES = [
    "checksPassed", // [*] → needsReview
    "checksFailed", // [*] / needsReview / readyToMerge → needsRevision
    "revisionResolved", // needsRevision → needsReview
    "reviewRequestedChanges", // needsReview → needsRevision
    "reviewPolicySatisfied", // needsReview → readyToMerge
    "approvalInvalidated", // readyToMerge → needsReview
    "humanClosed", // any → closed, unmerged
    "merged", // any → closed, merged
] as const;
export type PrCause = (typeof PR_CAUSES)[number];

export type TransitionCause = IssueCause | PrCause;

/**
 * The causes that may reach `to: null`. Every one maps to exactly one
 * `ClosureReason`, which is what lets `applyTransition` record WHY an
 * item closed without knowing which entity it is looking at.
 * `test/taxonomy.test.ts` pins the converse: no edge to `null` uses a
 * cause outside this set.
 */
export const CLOSURE_CAUSES = ["humanClosed", "linkedMergeClosed", "merged"] as const;
export type ClosureCause = (typeof CLOSURE_CAUSES)[number];

/** Pure: the closure a cause records, or `null` if it closes nothing. */
export function closureReasonFor(cause: TransitionCause): ClosureReason | null {
    switch (cause) {
        case "merged":
            return "merged";
        case "linkedMergeClosed":
            return "completedByLinkedMerge";
        case "humanClosed":
            return "closedByHuman";
        default:
            return null;
    }
}

interface Edge<M, C extends TransitionCause> {
    readonly from: M | null;
    readonly to: M | null;
    readonly causes: readonly C[];
}

/** taxonomy.md §4, verbatim as edges. */
const ISSUE_EDGES: readonly Edge<IssueMeaning, IssueCause>[] = [
    { from: null, to: "awaitingTriage", causes: ["intakeObserved"] },
    { from: "awaitingTriage", to: "ready", causes: ["triageCompleted"] },
    { from: "ready", to: "inProgress", causes: ["contributorAssigned"] },
    {
        from: "inProgress",
        to: "ready",
        causes: ["lastContributorUnassigned", "reclaimCompleted"],
    },
    { from: "awaitingTriage", to: null, causes: ["humanClosed"] },
    { from: "ready", to: null, causes: ["humanClosed", "linkedMergeClosed"] },
    { from: "inProgress", to: null, causes: ["humanClosed", "linkedMergeClosed"] },
    /**
     * FINDING(taxonomy-manual-entry), D29: "every state has a
     * non-module way in" implies manual-entry edges §4 omits. Manual
     * label application is observed reality to reconcile
     * (manual-edits.md), not a requestable transition — no edges added.
     */
];

/** taxonomy.md §5, verbatim as edges. */
const PR_EDGES: readonly Edge<PrMeaning, PrCause>[] = [
    { from: null, to: "needsReview", causes: ["checksPassed"] },
    { from: null, to: "needsRevision", causes: ["checksFailed"] },
    /**
     * FINDING(taxonomy-review-cause), D48: §5 labels this edge "New
     * evidence requires contributor action" — deliberately broader than
     * a failing check. The first implementation narrowed it to
     * `checksFailed` alone and left the narrowing untagged, which
     * dropped the audited PR Review Label Applicator: "on a
     * `changes_requested` review it force-swaps the status to
     * `status: needs revision`" (`audit/services-cpp.md`).
     * `reviewRequestedChanges` needs the `pull_request_review`
     * subscription experiment 6.6 found the App lacks.
     */
    {
        from: "needsReview",
        to: "needsRevision",
        causes: ["checksFailed", "reviewRequestedChanges"],
    },
    { from: "needsRevision", to: "needsReview", causes: ["revisionResolved"] },
    { from: "needsReview", to: "readyToMerge", causes: ["reviewPolicySatisfied"] },
    /**
     * `approvalInvalidated`, not the first implementation's
     * `newCommitsInvalidatedApproval` — FINDING(taxonomy-approval-cause),
     * D48. That name bundled a trigger (new commits) with the
     * consequence (the approval stopped counting) and so could not
     * express a dismissed review or a changed base. The consequence is
     * the transition; the trigger varies.
     */
    { from: "readyToMerge", to: "needsReview", causes: ["approvalInvalidated"] },
    /**
     * FINDING(taxonomy-approved-checks-broke), D48: MISSING from §5 and
     * from the first implementation — an approved pull request whose
     * checks break had no path to `needsRevision` at all
     * (`canTransitionPr` answered `noSuchEdge`), so the only exit
     * asserted commits had landed. Checks break without any push: the
     * audited Sibling Conflict Re-check re-reads every open PR's
     * `mergeable` state when a DIFFERENT pull request merges and swaps
     * `needs review` ↔ `needs revision` (`audit/services-cpp.md`).
     */
    { from: "readyToMerge", to: "needsRevision", causes: ["checksFailed"] },
    { from: "needsReview", to: null, causes: ["humanClosed", "merged"] },
    { from: "needsRevision", to: null, causes: ["humanClosed", "merged"] },
    { from: "readyToMerge", to: null, causes: ["humanClosed", "merged"] },
];

export interface TransitionRequest<M, C extends TransitionCause = TransitionCause> {
    readonly from: M | null;
    readonly to: M | null;
    readonly cause: C;
}

/**
 * Machine-readable refusal cause — the executor, telemetry, and managed
 * explanations branch on `code`; `reason` is prose for humans only.
 * Same convention as `FailureClass` in failures.ts.
 */
export type TransitionRefusalCode =
    | "noSuchEdge"
    | "causeNotAccepted"
    | "itemClosed"
    | "itemBlocked"
    | "stalePrecondition"
    | "notClosed"
    | "mergedNotReopenable";

export type TransitionVerdict =
    | { readonly allowed: true }
    | {
          readonly allowed: false;
          readonly code: TransitionRefusalCode;
          readonly reason: string;
      };

function evaluate<M, C extends TransitionCause>(
    edges: readonly Edge<M, C>[],
    request: TransitionRequest<M, C>,
): TransitionVerdict {
    const edge = edges.find(
        (e) => e.from === request.from && e.to === request.to,
    );
    if (!edge) {
        return {
            allowed: false,
            code: "noSuchEdge",
            reason: `no edge ${String(request.from)} -> ${String(request.to)} in the profile`,
        };
    }
    if (!edge.causes.includes(request.cause)) {
        return {
            allowed: false,
            code: "causeNotAccepted",
            reason: `edge ${String(request.from)} -> ${String(request.to)} does not accept cause ${request.cause}`,
        };
    }
    return { allowed: true };
}

/** Can an issue move `from` → `to` for `cause`, per the profile? Pure. */
export function canTransitionIssue(
    request: TransitionRequest<IssueMeaning, IssueCause>,
): TransitionVerdict {
    return evaluate(ISSUE_EDGES, request);
}

/** Can a pull request move `from` → `to` for `cause`, per the profile? Pure. */
export function canTransitionPr(
    request: TransitionRequest<PrMeaning, PrCause>,
): TransitionVerdict {
    return evaluate(PR_EDGES, request);
}

/** The edge tables, exposed read-only for the doc-drift check. */
export const PROFILE_EDGES: {
    readonly issue: readonly { readonly from: string | null; readonly to: string | null }[];
    readonly pullRequest: readonly { readonly from: string | null; readonly to: string | null }[];
} = {
    issue: ISSUE_EDGES.map((e) => ({ from: e.from, to: e.to })),
    pullRequest: PR_EDGES.map((e) => ({ from: e.from, to: e.to })),
};

/**
 * Apply a transition to an item's state, enforcing the two platform
 * invariants the test architecture names:
 *  - an item is never in two positions (structural: `meaning` is scalar);
 *  - a blocked item accepts no capability-requested transitions
 *    (safety.md §5 — pause stops writes).
 */
export function applyTransition<M, C extends TransitionCause>(
    state: WorkItemState<M>,
    request: TransitionRequest<M, C>,
    verdictFor: (r: TransitionRequest<M, C>) => TransitionVerdict,
): { readonly state: WorkItemState<M>; readonly verdict: TransitionVerdict } {
    if (state.closedBy !== null) {
        return {
            state,
            verdict: {
                allowed: false,
                code: "itemClosed",
                reason: `item is closed (${state.closedBy})`,
            },
        };
    }
    if (state.blocked) {
        return {
            state,
            verdict: {
                allowed: false,
                code: "itemBlocked",
                reason: "item is blocked — capability writes are paused (safety.md §5)",
            },
        };
    }
    if (state.meaning !== request.from) {
        return {
            state,
            verdict: {
                allowed: false,
                code: "stalePrecondition",
                reason: `stale precondition: item is at ${String(state.meaning)}, request assumed ${String(request.from)}`,
            },
        };
    }
    const verdict = verdictFor(request);
    if (!verdict.allowed) return { state, verdict };
    return {
        state: {
            // Closure is orthogonal to position: closing records why the
            // item closed but preserves the mapped position for reopen.
            meaning: request.to === null ? state.meaning : request.to,
            blocked: state.blocked,
            // Only a closure cause can reach `to: null` — pinned by the
            // edge-table invariant test, so this is never null here.
            closedBy: request.to === null ? closureReasonFor(request.cause) : null,
        },
        verdict,
    };
}

/**
 * Reopening is a closure CLEAR, not a transition — the same shape as
 * `blocked` (D28), and the reason the first implementation's "except
 * reopen (not modelled yet)" comment could not be resolved inside the
 * edge tables: closing never removed the position labels (D35), so a
 * reopened item comes back exactly where it was and no position moves.
 *
 * FINDING(taxonomy-reopen), D49: a merged pull request can never reopen
 * — GitHub does not permit it — so the closure reason makes that a typed
 * refusal rather than an edge nobody remembered to leave out.
 */
export function applyReopen<M>(
    state: WorkItemState<M>,
): { readonly state: WorkItemState<M>; readonly verdict: TransitionVerdict } {
    if (state.closedBy === null) {
        return {
            state,
            verdict: {
                allowed: false,
                code: "notClosed",
                reason: "item is already open — reopening is not a no-op to absorb silently",
            },
        };
    }
    if (state.closedBy === "merged") {
        return {
            state,
            verdict: {
                allowed: false,
                code: "mergedNotReopenable",
                reason: "a merged pull request cannot reopen",
            },
        };
    }
    return {
        state: { meaning: state.meaning, blocked: state.blocked, closedBy: null },
        verdict: { allowed: true },
    };
}

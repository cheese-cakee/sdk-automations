/**
 * The candidate Hiero workflow profile as executable logic —
 * `design/core/taxonomy.md` §2, §4, §5 turned into a transition table.
 *
 * These are internal meanings, not GitHub label strings; repositories map
 * them via configuration (`design/config/schema.md` §3). The tables below
 * encode exactly the two state diagrams in the design doc — where the doc
 * was ambiguous, the choice is recorded in a comment tagged FINDING and
 * belongs in the decision register.
 */

export type EntityKind = "issue" | "pullRequest";

/** Issue-flow meanings — taxonomy.md §4. */
export const ISSUE_MEANINGS = ["awaitingTriage", "ready", "inProgress"] as const;
export type IssueMeaning = (typeof ISSUE_MEANINGS)[number];

/** Pull-request-flow meanings — taxonomy.md §5. */
export const PR_MEANINGS = ["needsReview", "needsRevision", "readyToMerge"] as const;
export type PrMeaning = (typeof PR_MEANINGS)[number];

/**
 * FINDING(taxonomy-blocked), D28: §2 lists `blocked` as a meaning, but
 * neither state diagram (§4, §5) contains it, and safety.md §5 gives it
 * pause semantics. Modelled as an orthogonal pause flag — an item keeps
 * its position while paused. If maintainers want a position instead,
 * the state type and both tables change.
 */
export interface WorkItemState<M> {
    /** Current workflow position, `null` before entry / after close. */
    readonly meaning: M | null;
    /** Orthogonal pause — see FINDING(taxonomy-blocked). */
    readonly blocked: boolean;
    /** Closed items accept no further transitions except reopen (not modelled yet). */
    readonly closed: boolean;
}

/** The reason a transition is requested — every legal edge has a named cause. */
export type TransitionCause =
    | "intakeObserved" // [*] → awaitingTriage
    | "triageCompleted" // awaitingTriage → ready
    | "contributorAssigned" // ready → inProgress
    | "lastContributorUnassigned" // inProgress → ready
    | "reclaimCompleted" // inProgress → ready (approved reclaim)
    | "checksPassed" // [*] → needsReview
    | "checksFailed" // [*] → needsRevision, needsReview → needsRevision
    | "revisionResolved" // needsRevision → needsReview
    | "reviewPolicySatisfied" // needsReview → readyToMerge
    | "newCommitsInvalidatedApproval" // readyToMerge → needsReview
    | "humanClosed" // any → closed
    | "linkedMergeClosed"; // any → closed (issues), merge/close (PRs)

interface Edge<M> {
    readonly from: M | null;
    readonly to: M | null;
    readonly causes: readonly TransitionCause[];
}

/** taxonomy.md §4, verbatim as edges. */
const ISSUE_EDGES: readonly Edge<IssueMeaning>[] = [
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
const PR_EDGES: readonly Edge<PrMeaning>[] = [
    { from: null, to: "needsReview", causes: ["checksPassed"] },
    { from: null, to: "needsRevision", causes: ["checksFailed"] },
    { from: "needsReview", to: "needsRevision", causes: ["checksFailed"] },
    { from: "needsRevision", to: "needsReview", causes: ["revisionResolved"] },
    { from: "needsReview", to: "readyToMerge", causes: ["reviewPolicySatisfied"] },
    {
        from: "readyToMerge",
        to: "needsReview",
        causes: ["newCommitsInvalidatedApproval"],
    },
    { from: "needsReview", to: null, causes: ["humanClosed", "linkedMergeClosed"] },
    { from: "needsRevision", to: null, causes: ["humanClosed", "linkedMergeClosed"] },
    { from: "readyToMerge", to: null, causes: ["humanClosed", "linkedMergeClosed"] },
];

export interface TransitionRequest<M> {
    readonly from: M | null;
    readonly to: M | null;
    readonly cause: TransitionCause;
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
    | "stalePrecondition";

export type TransitionVerdict =
    | { readonly allowed: true }
    | {
          readonly allowed: false;
          readonly code: TransitionRefusalCode;
          readonly reason: string;
      };

function evaluate<M>(
    edges: readonly Edge<M>[],
    request: TransitionRequest<M>,
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
    request: TransitionRequest<IssueMeaning>,
): TransitionVerdict {
    return evaluate(ISSUE_EDGES, request);
}

/** Can a pull request move `from` → `to` for `cause`, per the profile? Pure. */
export function canTransitionPr(
    request: TransitionRequest<PrMeaning>,
): TransitionVerdict {
    return evaluate(PR_EDGES, request);
}

/**
 * Apply a transition to an item's state, enforcing the two platform
 * invariants the test architecture names:
 *  - an item is never in two positions (structural: `meaning` is scalar);
 *  - a blocked item accepts no capability-requested transitions
 *    (safety.md §5 — pause stops writes).
 */
export function applyTransition<M>(
    state: WorkItemState<M>,
    request: TransitionRequest<M>,
    verdictFor: (r: TransitionRequest<M>) => TransitionVerdict,
): { readonly state: WorkItemState<M>; readonly verdict: TransitionVerdict } {
    if (state.closed) {
        return {
            state,
            verdict: { allowed: false, code: "itemClosed", reason: "item is closed" },
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
            meaning: request.to,
            blocked: state.blocked,
            closed: request.to === null,
        },
        verdict,
    };
}

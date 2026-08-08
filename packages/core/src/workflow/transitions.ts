/**
 * The two workflow diagrams from `design/core/taxonomy.md` §4–§5, verbatim
 * as edge tables.
 *
 * `packages/checks/test/doc-drift.test.ts` parses the diagrams out of that document and
 * asserts these tables match them edge for edge, in both directions — the
 * tables ARE the design, transcribed, and a transcription with nothing
 * checking it is how D48's missing edge survived in both artifacts at once.
 */

import type {
    EntityKind,
    IssueCause,
    IssueMeaning,
    PrCause,
    PrMeaning,
    TransitionCause,
} from "./meanings.js";

export interface Edge<M, C extends TransitionCause> {
    readonly from: M | null;
    readonly to: M | null;
    readonly causes: readonly C[];
}

/**
 * taxonomy.md §4, verbatim as edges.
 *
 * No manual-entry edges, deliberately. Applying a label by hand is observed
 * reality to reconcile (manual-edits.md), not a transition anyone requests
 * (D29).
 */
export const ISSUE_EDGES: readonly Edge<IssueMeaning, IssueCause>[] = [
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
];

/**
 * taxonomy.md §5, verbatim as edges.
 *
 * Three of these came from reading the audit rather than the prose, and §5
 * has been corrected to match (D48). The one naming rule worth carrying:
 * a cause names the CONSEQUENCE, not the trigger — `approvalInvalidated`
 * covers new commits, a dismissed review and a changed base alike.
 */
export const PR_EDGES: readonly Edge<PrMeaning, PrCause>[] = [
    { from: null, to: "needsReview", causes: ["checksPassed"] },
    { from: null, to: "needsRevision", causes: ["checksFailed"] },
    {
        from: "needsReview",
        to: "needsRevision",
        causes: ["checksFailed", "reviewRequestedChanges"],
    },
    { from: "needsRevision", to: "needsReview", causes: ["revisionResolved"] },
    { from: "needsReview", to: "readyToMerge", causes: ["reviewPolicySatisfied"] },
    { from: "readyToMerge", to: "needsReview", causes: ["approvalInvalidated"] },
    { from: "readyToMerge", to: "needsRevision", causes: ["checksFailed"] },
    { from: "needsReview", to: null, causes: ["humanClosed", "merged"] },
    { from: "needsRevision", to: null, causes: ["humanClosed", "merged"] },
    { from: "readyToMerge", to: null, causes: ["humanClosed", "merged"] },
];


/** Both tables as bare from/to pairs — what the doc-drift check compares. */
export const PROFILE_EDGES: {
    readonly [K in EntityKind]: readonly {
        readonly from: string | null;
        readonly to: string | null;
    }[];
} = {
    issue: ISSUE_EDGES.map((e) => ({ from: e.from, to: e.to })),
    pullRequest: PR_EDGES.map((e) => ({ from: e.from, to: e.to })),
};

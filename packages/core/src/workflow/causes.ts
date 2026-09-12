/**
 * Why an item moves. Owned here: a repository maps labels to positions and
 * never configures transitions. Scoped per entity, so a pull-request cause on
 * an issue is a COMPILE error rather than a runtime rejection (D50).
 */

/** Issue-flow causes — taxonomy.md §4. */
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

/** Either flow's causes. `humanClosed` is the only member of both. */
export type TransitionCause = IssueCause | PrCause;

/** Cause narrowing, same shape as the meaning predicates (D90). */
export function isIssueCause(c: TransitionCause): c is IssueCause {
    return ISSUE_CAUSES.some((x) => x === c);
}
export function isPrCause(c: TransitionCause): c is PrCause {
    return PR_CAUSES.some((x) => x === c);
}

/** The causes that may reach `to: null`; each maps to exactly one `ClosureReason`. */
export const CLOSURE_CAUSES = ["humanClosed", "linkedMergeClosed", "merged"] as const;
export type ClosureCause = (typeof CLOSURE_CAUSES)[number];

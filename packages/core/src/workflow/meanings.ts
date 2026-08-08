/**
 * The vocabulary a work item is described in.
 *
 * Half of it is DERIVED and half is owned, which is worth knowing before
 * reading. The position meanings come from `config`'s facts table and are
 * only split by flow here. The causes, the closure reasons and the item
 * state are owned here and exist nowhere else.
 *
 * Data and names only. `transitions.ts` holds the edges, `apply.ts` the rules
 * that walk them. Every enumeration derives its union from its array (D76).
 */

import {
    MAPPABLE_MEANINGS,
    MEANING_FACTS,
    type EntityKind,
    type MappableMeaning,
} from "../config/index.js";

export type { EntityKind };

/**
 * Derived from `MEANING_FACTS`, never restated. Read the conditional as
 * "keep K when its declared flow is F, else discard it" — dense, but you
 * never need to read it to USE the types below, and tests pin the
 * results (D90).
 */
type MeaningsWithFlow<F extends EntityKind> = {
    [K in MappableMeaning]: (typeof MEANING_FACTS)[K]["flow"] extends F
        ? K
        : never;
}[MappableMeaning];

/** Issue-flow meanings — taxonomy.md §4. Derived; `blocked` excluded by construction. */
export type IssueMeaning = MeaningsWithFlow<"issue">;

/** Pull-request-flow meanings — taxonomy.md §5. Derived. */
export type PrMeaning = MeaningsWithFlow<"pullRequest">;

/** The one honest narrowing per flow — these replace every cast (D90). */
export function isIssueMeaning(m: MappableMeaning): m is IssueMeaning {
    return MEANING_FACTS[m].flow === "issue";
}
export function isPrMeaning(m: MappableMeaning): m is PrMeaning {
    return MEANING_FACTS[m].flow === "pullRequest";
}

/** The same sets as runtime arrays, in `MAPPABLE_MEANINGS` order. */
export const ISSUE_MEANINGS: readonly IssueMeaning[] =
    MAPPABLE_MEANINGS.filter(isIssueMeaning);
export const PR_MEANINGS: readonly PrMeaning[] =
    MAPPABLE_MEANINGS.filter(isPrMeaning);

/**
 * Why an item is closed, as GitHub reports it. Observed from `merged_at`
 * and `state_reason`, never written as a label.
 *
 * Closure is not a position: a closed item keeps whatever position labels it
 * carries (D35). And `merged` stays distinguishable from `closedByHuman`
 * because downstream policy branches on it — progression credits only a
 * merged linked pull request (D47).
 */
export type ClosureReason =
    /** A pull request merged — `merged_at` is set. */
    | "merged"
    /** A person closed the item; for a pull request, closed unmerged. */
    | "closedByHuman"
    /** An issue closed because a linked pull request merged. */
    | "completedByLinkedMerge";

/**
 * An item's workflow state. `blocked` is an orthogonal pause flag rather
 * than a position, so an item keeps its position while paused (D28) —
 * making it a position instead would change this type and both edge tables.
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
 * Issue-flow causes — taxonomy.md §4.
 *
 * Scoped per entity so a pull-request cause on an issue is a COMPILE error
 * rather than a runtime rejection — the same make-misuse-unrepresentable
 * rule `ids.ts` applies to delivery ids. The split costs nothing: no cause
 * is legal in both flows except `humanClosed` (D50).
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
 * Cause narrowing, same shape as the meaning predicates (D90). `.some`
 * rather than `.includes` because the latter demands the wider type up
 * front — comparison narrows for free, no widening needed.
 */
export function isIssueCause(c: TransitionCause): c is IssueCause {
    return ISSUE_CAUSES.some((x) => x === c);
}
export function isPrCause(c: TransitionCause): c is PrCause {
    return PR_CAUSES.some((x) => x === c);
}

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

/**
 * Is this item paused? Presence, nothing more (D28).
 *
 * One home on purpose. When the projection computed this and the safety
 * engine was handed a separate boolean saying the same thing, a shell could
 * project an item as blocked and then assert it was not.
 */
export function isBlocked(meanings: readonly MappableMeaning[]): boolean {
    return meanings.includes("blocked");
}

/**
 * Closure is a recorded REASON, not a position: read from GitHub's own fields
 * and never written as a label. Modelled orthogonally for the same reason as
 * `blocked` (D28) — as a meaning it would become mappable, and a merged pull
 * request still carrying `needs review` would project as a conflict
 * (`FINDING(taxonomy-closure-reason)`, D47, D35).
 */

/**
 * The vocabulary a work item is described in: entity kinds, the position
 * meanings for each flow, closure reasons, and the causes that move an item.
 *
 * Data and names only — `transitions.ts` holds the edges, `apply.ts` the
 * rules that walk them. Every enumeration derives its union from its array
 * (D76), so adding a member breaks compilation until every table is updated.
 */

import type { MappableMeaning } from "../config/index.js";

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
 * cleanup is gated `merged == true` (`design/audit/services-cpp.md`).
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

/**
 * Is this item paused?
 *
 * D28 makes `blocked` an orthogonal flag rather than a position, so the rule
 * is simply presence. It lives here, once, because two places used to decide
 * it: `project.ts` computed it from the observed meanings, and the safety
 * engine was handed a separate boolean asserting the same thing — with
 * nothing comparing them. A shell could project an item as blocked and then
 * assert it was not.
 */
export function isBlocked(meanings: readonly MappableMeaning[]): boolean {
    return meanings.includes("blocked");
}

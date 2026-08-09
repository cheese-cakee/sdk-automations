/**
 * What condition an item is in, and what closes it. Owned here.
 *
 * Two facts are modelled ORTHOGONALLY to position rather than as meanings,
 * for the same reason: as meanings they would become mappable, and a merged
 * pull request still carrying `needs review` would project as a conflict.
 * `blocked` is a pause flag (D28); closure is a recorded reason (D47).
 */

import type { MappableMeaning } from "../config/index.js";
import type { TransitionCause } from "./causes.js";

/**
 * Why an item is closed, as GitHub reports it. Observed from `merged_at` and
 * `state_reason`, never written as a label.
 *
 * A closed item keeps whatever position labels it carries (D35). `merged`
 * stays distinguishable from `closedByHuman` because downstream policy
 * branches on it — progression credits only a merged linked pull request.
 */
export type ClosureReason =
    /** A pull request merged — `merged_at` is set. */
    | "merged"
    /** A person closed the item; for a pull request, closed unmerged. */
    | "closedByHuman"
    /** An issue closed because a linked pull request merged. */
    | "completedByLinkedMerge";

/**
 * An item's workflow state. Making `blocked` a position instead of a flag
 * would change this type and both edge tables (D28). Closed items accept no
 * transitions; `applyReopen` is the only way back to open.
 */
export interface WorkItemState<M> {
    /** Current position, `null` before entry or with no mapped label. */
    readonly meaning: M | null;
    readonly blocked: boolean;
    readonly closedBy: ClosureReason | null;
}

/**
 * Pure: the closure a cause records, or `null` if it closes nothing.
 *
 * The bridge between a cause and a state lives on this side because the
 * other direction would be a cycle — `causes.ts` imports nothing.
 */
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

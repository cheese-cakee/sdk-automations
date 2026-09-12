/** What condition an item is in. `blocked` is a pause flag (D28); closure a reason (D47). */

import type { MappableMeaning } from "../config/index.js";
import type { TransitionCause } from "./causes.js";

/** Why an item is closed, as GitHub reports it — observed, never written as a label (D35). */
export type ClosureReason =
    /** A pull request merged — `merged_at` is set. */
    | "merged"
    /** A person closed the item; for a pull request, closed unmerged. */
    | "closedByHuman"
    /** An issue closed because a linked pull request merged. */
    | "completedByLinkedMerge";

/** An item's workflow state. Closed items accept no transitions; `applyReopen` is the way back. */
export interface WorkItemState<M> {
    /** Current position, `null` before entry or with no mapped label. */
    readonly meaning: M | null;
    readonly blocked: boolean;
    readonly closedBy: ClosureReason | null;
}

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

/** Is this item paused? Presence, nothing more — one home, so nothing can disagree (D28). */
export function isBlocked(meanings: readonly MappableMeaning[]): boolean {
    return meanings.includes("blocked");
}

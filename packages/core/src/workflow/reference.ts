/**
 * The taxonomy as an executable spec: given a state and a requested move, what
 * does the item look like afterwards?
 *
 * NOTHING IN PRODUCTION CALLS THIS. It walks the whole state machine — the test
 * oracle today, the adapter's read-back conformance checker when that lands
 * (D93). Read it as a specification, not as a hot path.
 */

import type { IssueMeaning, PrMeaning } from "./positions.js";
import type { IssueCause, PrCause, TransitionCause } from "./causes.js";
import { closureReasonFor, type WorkItemState } from "./state.js";
import {
    canTransitionIssue,
    canTransitionPr,
    type TransitionRequest,
    type TransitionVerdict,
} from "./transitions.js";

/** A state and the verdict that produced it. */
export interface Outcome<M> {
    readonly state: WorkItemState<M>;
    readonly verdict: TransitionVerdict;
}

/** The walk itself, generic so both flows share it. */
function walk<M, C extends TransitionCause>(
    state: WorkItemState<M>,
    request: TransitionRequest<M, C>,
    verdictFor: (r: TransitionRequest<M, C>) => TransitionVerdict,
): Outcome<M> {
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
                reason: "item is blocked — capability writes are paused (contracts/safety.md §3)",
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
            // Closure is orthogonal to position: the position survives for reopen.
            meaning: request.to === null ? state.meaning : request.to,
            blocked: state.blocked,
            // Only a closure cause reaches `to: null` — pinned by the edge-table test.
            closedBy: request.to === null ? closureReasonFor(request.cause) : null,
        },
        verdict,
    };
}

/** Walk an issue's move. The issue table is named here, not passed in. */
export function applyIssueTransition(
    state: WorkItemState<IssueMeaning>,
    request: TransitionRequest<IssueMeaning, IssueCause>,
): Outcome<IssueMeaning> {
    return walk(state, request, canTransitionIssue);
}

/** Walk a pull request's move. */
export function applyPrTransition(
    state: WorkItemState<PrMeaning>,
    request: TransitionRequest<PrMeaning, PrCause>,
): Outcome<PrMeaning> {
    return walk(state, request, canTransitionPr);
}

/**
 * Reopening is a closure CLEAR, not a transition: closing never removes the
 * position labels (D35), so a reopened item returns where it was.
 */
export function applyReopen<M>(state: WorkItemState<M>): Outcome<M> {
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

/**
 * Observed labels to workflow position — the projection step that
 * `design/guides/manual-edits.md` §3 implies but no document owns.
 *
 * GitHub's reality is a SET of labels; the state machine's is a scalar
 * position. The shell turns label strings into meanings through the
 * validated mapping, which the config layer guarantees is injective, and
 * passes the meanings here.
 *
 * More than one own-flow position is a conflict, never a repair (§3). A
 * conflicted item has no `WorkItemState`, so it can never reach
 * `applyTransition` — the no-write rule is structural, not a check.
 */

import { ISSUE_MEANINGS, PR_MEANINGS, type IssueMeaning, type PrMeaning } from "./positions.js";
import { isBlocked, type ClosureReason, type WorkItemState } from "./state.js";
import type { MappableMeaning } from "../config/index.js";

/**
 * What the shell observed on one issue or pull request. `meanings` holds
 * only MAPPED meanings — an unmapped label never appears here, so the
 * platform leaves it alone entirely (§3 rule 1).
 */
export interface LabelObservation {
    readonly closedBy: ClosureReason | null;
    readonly meanings: readonly MappableMeaning[];
}

/**
 * A set of labels read as a position, or refused as a conflict.
 *
 * The conflict branch repeats `blocked` and `closedBy` so an operator can
 * judge whether it needs attention (D59). `ignored` is the other flow's
 * meanings, reported but never a conflict (D35).
 */
export type ObservationProjection<M> =
    | {
          readonly kind: "position";
          readonly state: WorkItemState<M>;
          readonly ignored: readonly MappableMeaning[];
      }
    | {
          readonly kind: "conflict";
          readonly positions: readonly M[];
          readonly blocked: boolean;
          readonly closedBy: ClosureReason | null;
          readonly ignored: readonly MappableMeaning[];
      };

function projectWith<M extends IssueMeaning | PrMeaning>(
    own: readonly M[],
    observation: LabelObservation,
): ObservationProjection<M> {
    const distinct = [...new Set(observation.meanings)];
    const ownSet: ReadonlySet<MappableMeaning> = new Set(own);
    const positions = distinct.filter((m): m is M => ownSet.has(m));
    if (positions.length > 1) {
        return {
            kind: "conflict",
            positions,
            blocked: isBlocked(distinct),
            closedBy: observation.closedBy,
            ignored: distinct.filter((m) => !ownSet.has(m) && m !== "blocked"),
        };
    }
    // `blocked` with no position is legal — "no position, paused" (D28) —
    // and a closed item keeps its position labels unrepaired, with the
    // closure reason riding alongside rather than erasing them (D35, D47).
    return {
        kind: "position",
        state: {
            meaning: positions[0] ?? null,
            blocked: isBlocked(distinct),
            closedBy: observation.closedBy,
        },
        ignored: distinct.filter((m) => !ownSet.has(m) && m !== "blocked"),
    };
}

/** Project an issue's observed mapped meanings. Pure. */
export function projectIssueObservation(
    observation: LabelObservation,
): ObservationProjection<IssueMeaning> {
    return projectWith(ISSUE_MEANINGS, observation);
}

/** Project a pull request's observed mapped meanings. Pure. */
export function projectPrObservation(
    observation: LabelObservation,
): ObservationProjection<PrMeaning> {
    return projectWith(PR_MEANINGS, observation);
}

/**
 * Is this item closed, whichever branch the projection took?
 *
 * Closure sits in two places: `state.closedBy` on a position, `closedBy` at
 * the top level on a conflict (D59). Reading one branch compiles fine and
 * silently treats every conflicted, closed item as open, which is the
 * mistake the first capability to consume a projection made.
 */
export function closureOf<M>(projection: ObservationProjection<M>): ClosureReason | null {
    return projection.kind === "position" ? projection.state.closedBy : projection.closedBy;
}

/** Is this item paused, whichever branch the projection took? See `closureOf`. */
export function isPausedByProjection<M>(projection: ObservationProjection<M>): boolean {
    return projection.kind === "position" ? projection.state.blocked : projection.blocked;
}

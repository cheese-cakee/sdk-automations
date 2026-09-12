/**
 * Observed labels to workflow position — the projection human sovereignty
 * implies (`design/contracts/safety.md` §3).
 *
 * More than one own-flow position is a conflict, never a repair: a conflicted
 * item has no `WorkItemState`, so it can never reach `applyTransition`.
 */

import { ISSUE_MEANINGS, PR_MEANINGS, type IssueMeaning, type PrMeaning } from "./positions.js";
import { isBlocked, type ClosureReason, type WorkItemState } from "./state.js";
import type { MappableMeaning } from "../config/index.js";

/** What the shell observed on one item. `meanings` holds only MAPPED meanings (§3 rule 1). */
export interface LabelObservation {
    readonly closedBy: ClosureReason | null;
    readonly meanings: readonly MappableMeaning[];
}

/** A set of labels read as a position, or refused as a conflict. `ignored` is reported (D35). */
export type Projection<M> =
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
): Projection<M> {
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
    // `blocked` with no position is legal — "no position, paused" (D28).
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
export function projectIssue(observation: LabelObservation): Projection<IssueMeaning> {
    return projectWith(ISSUE_MEANINGS, observation);
}

/** Project a pull request's observed mapped meanings. Pure. */
export function projectPullRequest(observation: LabelObservation): Projection<PrMeaning> {
    return projectWith(PR_MEANINGS, observation);
}

/**
 * Is this item closed, whichever branch the projection took? Closure sits in
 * two places — `state.closedBy` on a position, `closedBy` on a conflict (D59).
 */
export function closureOf<M>(projection: Projection<M>): ClosureReason | null {
    return projection.kind === "position" ? projection.state.closedBy : projection.closedBy;
}

/** Is this item paused, whichever branch the projection took? See `closureOf`. */
export function isPausedByProjection<M>(projection: Projection<M>): boolean {
    return projection.kind === "position" ? projection.state.blocked : projection.blocked;
}

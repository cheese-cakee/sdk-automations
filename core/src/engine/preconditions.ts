/**
 * The safety context, DERIVED — D92's finishing of D77.
 *
 * D77 ruled "the shell supplies observations; core computes conclusions",
 * and then `WriteContext` went on asking callers for two conclusions —
 * `observedMeanings` and `preconditionHolds` — that follow from the
 * projection core was handed in the same breath. Nothing compared the
 * caller's restatement to the source, so a shell asserting a stale
 * precondition was believed. These two functions are the comparison,
 * written once, where the observation lives.
 */

import { MAPPABLE_MEANINGS, type MappableMeaning } from "../config/index.js";
import { closureOf, type ObservationProjection } from "../workflow/index.js";
import type { ExpectedFacts } from "../capability/index.js";

/**
 * Every mapped meaning the observation actually carried, reconstructed from
 * the projection — both branches, in `MAPPABLE_MEANINGS` order. The inverse
 * of what `project.ts` split apart: position (or conflict positions),
 * cross-flow `ignored`, and the `blocked` flag reassemble into the set the
 * safety engine's `itemBlocked` rule and the precondition check read.
 */
export function observedMeaningsOf<M extends MappableMeaning>(
    projection: ObservationProjection<M>,
): readonly MappableMeaning[] {
    const present = new Set<MappableMeaning>();
    if (projection.kind === "position") {
        if (projection.state.meaning !== null) present.add(projection.state.meaning);
        if (projection.state.blocked) present.add("blocked");
    } else {
        for (const position of projection.positions) present.add(position);
        if (projection.blocked) present.add("blocked");
    }
    for (const ignored of projection.ignored) present.add(ignored);
    return MAPPABLE_MEANINGS.filter((m) => present.has(m));
}

/**
 * Does the capability's claimed world match the observed one?
 *
 * The three clauses of `ExpectedFacts`, each against the projection:
 * every meaning claimed present is present; no meaning claimed absent is
 * present; and the open/closed claim matches `closureOf` (both branches —
 * the asymmetry trap that function exists for). `closed: null` is
 * "no claim", never "claims open".
 */
export function expectedHolds<M extends MappableMeaning>(
    expected: ExpectedFacts,
    projection: ObservationProjection<M>,
): boolean {
    const observed = new Set(observedMeaningsOf(projection));
    for (const meaning of expected.meaningsPresent) {
        if (!observed.has(meaning)) return false;
    }
    for (const meaning of expected.meaningsAbsent) {
        if (observed.has(meaning)) return false;
    }
    if (expected.closed !== null) {
        const isClosed = closureOf(projection) !== null;
        if (expected.closed !== isClosed) return false;
    }
    return true;
}

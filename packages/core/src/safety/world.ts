/**
 * The derived world: the safety facts a rule may read, and the only way to
 * make them. Derivation is the sole constructor (D92).
 */

import { MAPPABLE_MEANINGS, type MappableMeaning } from "../config/index.js";
import { closureOf, type ClosureReason, type Projection } from "../workflow/index.js";

/** A pull request's native mode — GitHub's own state, never a label. */
export const PULL_REQUEST_MODES = ["draft", "changesRequested"] as const;

export type PullRequestMode = (typeof PULL_REQUEST_MODES)[number];

/**
 * Which native modes an observation READ. An absent mode was not read — never
 * "the item is not in it" — and a claim on it is refused (D51).
 */
export type ObservedModes = { readonly [M in PullRequestMode]?: boolean };

/** What a capability claims about the world (`design/contracts/safety.md`). */
export interface ClaimedFacts {
    readonly meaningsPresent: readonly MappableMeaning[];
    readonly meaningsAbsent: readonly MappableMeaning[];
    /** `null` when the capability makes no open/closed claim. */
    readonly closed: boolean | null;
    /** The native mode the decision saw, or absent for no claim. */
    readonly pullRequestMode?: PullRequestMode;
}

/** Not exported from the barrel — constructing a DerivedWorld goes through `deriveWorld`. */
export const DERIVED: unique symbol = Symbol("derived-by-engine");

/** The safety facts a rule may read, derivable only (D92). */
export interface DerivedWorld {
    readonly observedMeanings: readonly MappableMeaning[];
    readonly preconditionHolds: boolean;
    /** Why the observed item is closed, or `null` if it is open. */
    readonly closure: ClosureReason | null;
    readonly modes: ObservedModes;
    readonly [DERIVED]: true;
}

/** Every mapped meaning the observation carried, in `MAPPABLE_MEANINGS` order. */
export function observedMeaningsOf<M extends MappableMeaning>(
    projection: Projection<M>,
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

/** Does the claimed world match the observed one? */
export function expectedHolds<M extends MappableMeaning>(
    claims: ClaimedFacts,
    projection: Projection<M>,
    modes: ObservedModes = {},
): boolean {
    const observed = new Set(observedMeaningsOf(projection));
    for (const meaning of claims.meaningsPresent) {
        if (!observed.has(meaning)) return false;
    }
    for (const meaning of claims.meaningsAbsent) {
        if (observed.has(meaning)) return false;
    }
    if (claims.closed !== null) {
        const isClosed = closureOf(projection) !== null;
        if (claims.closed !== isClosed) return false;
    }
    if (claims.pullRequestMode !== undefined && modes[claims.pullRequestMode] !== true) {
        return false;
    }
    return true;
}

/**
 * The one constructor: missing or conflicted projection data cannot establish
 * an authoritative precondition.
 */
export function deriveWorld<M extends MappableMeaning>(
    projection: Projection<M> | null,
    claims: ClaimedFacts,
    modes: ObservedModes = {},
): DerivedWorld {
    return {
        observedMeanings: projection === null ? [] : observedMeaningsOf(projection),
        preconditionHolds:
            projection !== null &&
            projection.kind === "position" &&
            expectedHolds(claims, projection, modes),
        closure: projection === null ? null : closureOf(projection),
        modes,
        [DERIVED]: true,
    };
}

/** FOR CORE'S OWN RULE TESTS ONLY — must stay absent from the barrel. */
export function assertedWorld(
    observedMeanings: readonly MappableMeaning[],
    preconditionHolds: boolean,
    closure: ClosureReason | null = null,
    modes: ObservedModes = {},
): DerivedWorld {
    return { observedMeanings, preconditionHolds, closure, modes, [DERIVED]: true };
}

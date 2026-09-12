/**
 * The workflow layer: what states exist, and how they move.
 *
 * `positions.ts` is where an item sits (derived from config), `causes.ts` why
 * it moves, `state.ts` what condition it is in. `transitions.ts` holds the
 * edge tables and answers whether a move is legal — that is the one production
 * path. `reference.ts` walks the whole machine as an executable spec that
 * nothing in production calls (a test oracle today, the adapter's read-back
 * conformance checker later — D93). `project.ts` reads observed labels as a
 * position. Half the vocabulary is DERIVED and half is OWNED: positions come
 * from `config`'s facts table and are only split by flow, while causes,
 * closure and item state exist nowhere else.
 *
 * THREE THINGS MODELLED ORTHOGONALLY, on purpose. `blocked` is a pause FLAG,
 * not a position: an item keeps its position while paused and unblocking
 * restores it unchanged (D28). Closure is a recorded REASON, not a position: a
 * closed item keeps its labels, and `merged` stays distinguishable from
 * `closedByHuman` because downstream policy branches on it (D47). A CONFLICT —
 * more than one own-flow position — is refused, never repaired (D35); a
 * conflicted item has no `WorkItemState`, so the no-write rule is structural
 * rather than a check anyone remembers to make.
 *
 * THE COST THIS DIRECTORY CHOOSES: almost everything exists twice, once per
 * flow — meanings, causes, edges, both predicate pairs, the legality check,
 * the projection, the reference walk. Eight pairs, deliberately, because
 * entity-scoping makes a pull-request cause on an issue a COMPILE error rather
 * than a runtime rejection (D50). Read the repetition as a decision.
 */
export * from "./positions.js";
export * from "./causes.js";
export * from "./state.js";
export * from "./transitions.js";
export * from "./reference.js";
export * from "./project.js";

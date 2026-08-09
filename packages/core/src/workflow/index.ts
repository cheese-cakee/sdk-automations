/**
 * The workflow layer: what states exist, and how they move.
 *
 * `positions.ts` is where an item sits (derived from config), `causes.ts` why
 * it moves, `state.ts` what condition it is in. `transitions.ts` holds the
 * edge tables and answers whether a move is legal — that is the one production
 * path. `reference.ts` walks the whole machine as an executable spec that
 * nothing in production calls. `project.ts` reads observed labels as a
 * position.
 */
export * from "./positions.js";
export * from "./causes.js";
export * from "./state.js";
export * from "./transitions.js";
export * from "./reference.js";
export * from "./project.js";

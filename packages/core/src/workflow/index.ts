/**
 * The workflow layer: what states exist, and how they move.
 *
 * `positions.ts` is where an item sits (derived from config), `causes.ts` why
 * it moves, `state.ts` what condition it is in. `transitions.ts` holds the
 * diagrams as edge tables, `apply.ts` the rules that walk them, `project.ts`
 * the step from observed labels to a position.
 */
export * from "./positions.js";
export * from "./causes.js";
export * from "./state.js";
export * from "./transitions.js";
export * from "./apply.js";
export * from "./project.js";

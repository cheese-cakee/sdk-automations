/**
 * The workflow layer: what states exist, and how they move.
 *
 * `meanings.ts` is the vocabulary, `transitions.ts` the diagrams as tables,
 * `apply.ts` the rules that walk them, `project.ts` the step from observed
 * labels to a position.
 */
export * from "./meanings.js";
export * from "./transitions.js";
export * from "./apply.js";
export * from "./project.js";

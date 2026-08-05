/**
 * The safety layer: may this write happen?
 *
 * `write.ts` is the general entry point; `destructive.ts` holds the §3
 * warning and grace gates that clock-triggered actions pass INSTEAD, not as
 * well (D52). `rules.ts` holds the general rules both entry points share. Only
 * their ORDER is exported, because D52 was a precedence defect.
 */
export * from "./types.js";
export { evaluateWrite } from "./write.js";
// The rule ORDER is contract (D39, D52), so the list is public for tests to
// assert directly. The rules themselves stay internal.
export { GENERAL_RULES } from "./rules.js";
export * from "./destructive.js";

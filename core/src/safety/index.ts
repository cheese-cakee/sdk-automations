/**
 * The safety layer: may this write happen?
 *
 * `write.ts` is the general entry point; `destructive.ts` holds the §3
 * warning and grace gates that clock-triggered actions pass INSTEAD, not as
 * well (D52). `internal.ts` is the shared middle and is NOT exported — the
 * middle of a safety decision is not something a consumer should call.
 */
export * from "./types.js";
export { evaluateWrite } from "./write.js";
// The rule ORDER is contract (D39, D52), so the list is public for tests to
// assert directly. The rules themselves stay internal.
export { GENERAL_RULES } from "./internal.js";
export * from "./destructive.js";

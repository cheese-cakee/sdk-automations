/**
 * The shell owns ORDER, not decisions: verify before accept, accept
 * before ack, decide before act, then atomically commit the canonical report
 * and delivery completion (D93, D110).
 * `main.ts` is the runnable entry point and is deliberately not exported.
 */
export * from "./receiver.js";
export * from "./config.js";
export * from "./externals.js";
export * from "./effects.js";
/** The four walks the write path is driven through; `operations/` is otherwise internal. */
export { operationOf, parseJournaledCall, planFor, serializeCall } from "./operations/index.js";
export * from "./apply.js";
export * from "./log.js";
/**
 * The worker itself, because the sweep's seam names its shapes: a
 * `SweepProcessor` promises a `ShellRecord` for a `FactRecordInput`, and a
 * surface that published the promise while withholding both types would be one
 * nobody outside this directory could implement or read.
 */
export * from "./processor.js";
export * from "./schedule.js";
export * from "./sweep.js";
export * from "./shell.js";

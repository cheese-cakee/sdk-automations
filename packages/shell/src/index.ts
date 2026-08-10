/**
 * The shell owns ORDER, not decisions: verify before accept, accept
 * before ack, decide before act, commit before project (D93, D110).
 * `main.ts` is the runnable entry point and is deliberately not exported.
 */
export * from "./receiver.js";
export * from "./processor.js";
export * from "./config.js";
export * from "./reports.js";
export * from "./externals.js";
export * from "./shell.js";

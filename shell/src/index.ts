/**
 * The shell owns ORDER, not decisions: verify before accept, accept
 * before ack, decide before act, report always (D93). `main.ts` is the
 * runnable entry point and is deliberately not exported.
 */
export * from "./receiver.js";
export * from "./processor.js";
export * from "./config.js";
export * from "./reports.js";
export * from "./externals.js";
export * from "./shell.js";

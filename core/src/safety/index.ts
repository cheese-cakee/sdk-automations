/**
 * The safety layer: may this write happen?
 *
 * `write.ts` holds the general rules every write passes; `destructive.ts`
 * holds the §3 warning and grace gates that clock-triggered actions pass
 * INSTEAD — not as well (D52).
 */
export * from "./write.js";
export * from "./destructive.js";

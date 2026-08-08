/**
 * The capability layer: what a capability may declare, and how it is called.
 *
 * `declaration.ts` is what it is, `catalogue.ts` the vocabularies it chooses
 * from, `boundary.ts` how the platform invokes it, `intent.ts` what it asks
 * for and the screens that request passes.
 */
export * from "./declaration.js";
export * from "./catalogue.js";
export * from "./boundary.js";
export * from "./intent.js";
export * from "./factory.js";

/**
 * The capability layer: what a capability may declare, and how it is called.
 *
 * `catalogue.ts` holds the closed vocabularies. `declaration.ts` is what a
 * capability says about itself, `registry.ts` which declarations the platform
 * admits. `intent.ts` is what a capability asks for plus the screens that
 * request passes, `factory.ts` how one is built. `boundary.ts` is how the
 * platform invokes a capability, and what it lets it see.
 */
export * from "./catalogue.js";
export * from "./declaration.js";
export * from "./registry.js";
export * from "./intent.js";
export * from "./factory.js";
export * from "./boundary.js";

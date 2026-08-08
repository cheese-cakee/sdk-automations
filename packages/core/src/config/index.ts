/**
 * The configuration layer: what a repository asked for.
 *
 * `schema.ts` is the shape, `validate.ts` the rules, `parse.ts` the entry
 * point. This barrel exists so consumers name the CONCERN rather than the
 * file inside it — a capability cares that configuration was validated, not
 * which of three files did which part.
 */
export * from "./schema.js";
export { parseConfig } from "./parse.js";
export { parseConfigDocument } from "./document.js";
export { labelKey, meaningOfLabel, meaningsOfLabels } from "./mappings.js";
